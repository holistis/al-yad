import type { Action, ActResult, RunStatus, Snapshot, Attachment } from "@yad/shared";
import type { ChatRequest } from "../engine/types.js";
import { buildMessages, type HistoryItem } from "./prompt.js";
import { parseMicroPlan, type PlannedStep } from "./parse.js";
import { callJudge } from "../judge/judge.js";
import { evaluatePredicates, evaluatePredicate, parsePredicate } from "./predicate.js";
import { checkDenied, needsConfirm, pathIsDenied, type GateContext } from "../gate/guardrails.js";
import type { SnapshotNode } from "@yad/shared";
import { getSiteProfile, getProfileByTier, type SiteProfile, type SiteTier } from "../engine/site-profile.js";
import { CacheStore, makeCacheKey, urlToPattern } from "../memory/cache-store.js";
import { replayCache } from "../memory/replay.js";
import { makeSignal, type Signal } from "./arbiter.js";
import { SubstateTracker, type Substate } from "./substate.js";
import type { RecoveryStore } from "../memory/recovery-store.js";
import type { SelectorStore } from "../memory/selector-store.js";
import { generatePredicates, type PredicateChat } from "./predicate-generator.js";

/** Plafond op het aantal keren dat één run Claude Code om een herstelplan mag vragen.
 *  Voorkomt een meta-lus: YAD vraagt hulp → plan faalt → vraagt opnieuw → etc. */
const MAX_RECOVERY_ATTEMPTS = 3;

/** Trefwoorden die een vergelijk/rangschik/tel-vraag aanduiden (NL+EN) — zelfde categorie als
 *  prompt.ts's "COMPARE/RANK/COUNT TASKS"-regel ("gebruik ALTIJD extract zonder ref"). Gebruikt
 *  door de code-niveau bewaker in run() die een ref-gerichte extract op zo'n vraag corrigeert
 *  naar een volledige-pagina-extract. Ontdekt op 2026-08-28 (benchmark bk-002/bk-003): het model
 *  volgt deze prompt-regel niet altijd — koos een ref die naar een navigatie-link wees ("Home")
 *  i.p.v. de daadwerkelijke prijslijst, en gaf dat letterlijk terug als antwoord. Zelfde soort
 *  vangnet als de bestaande extract-lus-bewaker verderop in run(). */
const COMPARE_RANK_COUNT_PATTERN =
  /goedkoopste|duurste|meeste|minste|beste|slechtste|hoogste|laagste|populairste|hoeveel|aantal|cheapest|most expensive|highest|lowest|most popular|least popular|how many|count of|number of/i;

/**
 * Bewust EENZIJDIG conservatief: alleen expliciete actiewerkwoorden, geen brede
 * interpretatie. Fout in deze richting (een schrijfdoel niet herkend) verandert
 * niets aan het bestaande gedrag; fout in de andere richting (een leesdoel ten
 * onrechte als schrijfdoel gezien) zou een informatief doel onterecht laten
 * weigeren. Bij twijfel dus liever een gemist schrijfdoel dan een vals geweigerd
 * leesdoel.
 *
 * Gevonden op 2026-09-07 (PROBE G in het onderzoek van die dag): een doel als
 * "plaats een reactie" kreeg, bij nul uitgevoerde acties en een kale finish zonder
 * enig predicaat, gewoon status "klaar". stateChanged() is dan ook false (er
 * gebeurde niets), en "geen predicaten, geen statusverandering" wordt vandaag
 * gelezen als een informatief doel in plaats van een genegeerde opdracht.
 */
const WRITE_GOAL_PATTERN =
  /\b(plaats|post|verstuur|verzend|typ|schrijf|klik|druk|vul in|log in|meld aan|reageer|antwoord|bevestig|bestel|koop|betaal|upload|verwijder|schrap|abonneer|volg|like|deel)\b|\b(post|send|submit|type|write|click|press|fill in|log ?in|sign ?in|reply|comment|confirm|order|buy|pay|upload|delete|remove|subscribe|follow|share)\b/i;

function isWriteGoal(goal: string): boolean {
  return WRITE_GOAL_PATTERN.test(goal);
}

function isCompareRankCountGoal(goal: string): boolean {
  return COMPARE_RANK_COUNT_PATTERN.test(goal);
}

/**
 * Action kinds that change page/form/application state in a way the DONE-predicate
 * finish gate can (and per prompt.ts, should) demand proof for -- clicking a menu
 * option, typing into a field, picking a sort/filter value, uploading a file, etc.
 *
 * Mirrors the "isMutating" list used further down by the effect-nul detector (see the
 * comment there), plus a few newer action kinds (upload-local, drag, right-click,
 * history) that are equally state-changing but were added to the Action union after
 * that detector was written. "navigate" is deliberately excluded, same as in that
 * detector and for the same reason: the browser is very often already sitting on the
 * goal page before the model plans its first step (the run was started with a target
 * URL), so a run that never does more than read that page must stay eligible for
 * prompt.ts's "purely informational goals ... omit done" carve-out even when a
 * `navigate` step happens to be the one that got it there.
 */
const DONE_REQUIRED_ACTION_KINDS = new Set<Action["kind"]>([
  "click", "click-at", "type", "paste", "select", "hover", "keyboard",
  "upload", "upload-local", "drag", "right-click", "history",
]);

/**
 * True once this run has performed at least one action from DONE_REQUIRED_ACTION_KINDS.
 * Used by the finish gate to tell apart the two situations an empty/omitted "done"
 * array can mean:
 *  - the run never interacted with the page (extract/wait/scroll only) -- prompt.ts's
 *    documented "purely informational goal" carve-out, which must be allowed to omit
 *    done and still reach "klaar".
 *  - the run DID click/type/select/etc and still supplies no proof -- the original
 *    false-"klaar" bug (see PROMPT-FIX-VALSE-KLAAR.md: the model claimed a HackerOne
 *    asset click / weakness-menu selection had happened with zero objective proof).
 */
function hasStateChangingAction(history: HistoryItem[]): boolean {
  return history.some((h) => DONE_REQUIRED_ACTION_KINDS.has(h.action.kind));
}

export interface ChatLike {
  chat(req: ChatRequest): Promise<{ content: string; provider: string; model: string }>;
}

export interface HandBridge {
  requestSnapshot(): Promise<Snapshot>;
  /** Screenshot van de actieve tab als data-URL (JPEG). Null bij fout of geen extensie. */
  requestScreenshot(): Promise<string | null>;
  act(action: Action): Promise<ActResult>;
  requestConfirm(action: Action, reason: string): Promise<boolean>;
  update(u: { status: RunStatus; step?: number; message: string; action?: Action }): void;
}

/** Waarom de loop vastzit — voor Claude Code om te diagnosticeren. */
export interface StuckReason {
  why:
    | "repeat"                   // exact dezelfde actie herhaald
    | "consecutive-unknowns"     // judge kan uitkomst niet beoordelen
    | "parse-fail"               // model geeft onleesbare plannen
    | "consecutive-act-failures" // browser weigert acties (DOM-probleem/drift)
    | "state-loop"               // dezelfde browserstate keert terug na andere acties
    | "no-progress"              // geen judge-match in 6+ LLM-aanroepen
    | "goal-drift"               // agent blijft op zelfde URL maar Judge ziet geen doelvoortgang
    | "url-regression"           // agent keert terug naar al-bezochte URL (afdwaling)
    | "silent-no-effect"         // muterende actie slaagt (ok=true) maar verandert de pagina niet
    | "unintended-navigation";   // klik op niet-link element veroorzaakte onverwachte URL-navigatie
  runId: string;
  goal: string;
  url: string;
  lastAction: Action;
  history: HistoryItem[];
}

/**
 * Compacte vingerafdruk van een snapshot voor loop-detectie.
 * Stabiel genoeg om ruis te filteren, gevoelig genoeg voor echte state-changes.
 * Bevat: URL-pad + gesorteerde interactieve elementen (role:name) + aantal gevulde velden.
 */
function snapshotFingerprint(snapshot: Snapshot): string {
  const path = (() => {
    try { return new URL(snapshot.url).pathname; } catch { return snapshot.url.slice(0, 80); }
  })();
  const elems = snapshot.nodes
    .slice(0, 60)
    .filter((n) => !n.disabled)
    .map((n) => `${n.role}:${n.name.slice(0, 25)}`)
    .sort()
    .join("|");
  // Gevulde inputvelden tellen: typische formulier-voortgang verandert dit getal
  const filledCount = snapshot.nodes.filter((n) => n.value && n.value.trim()).length;
  return `${path}||${elems}||f${filledCount}`;
}

/**
 * Volgorde-GEVOELIGE vingerafdruk — voor effect-nul-detectie (stil falen).
 *
 * Anders dan snapshotFingerprint sorteert deze NIET: een herordening van elementen
 * (bv. een sorteertaak die de productvolgorde omdraait) MOET de afdruk veranderen.
 * Bevat: URL-pad + eerste 12 elementen in DOM-volgorde (role:name=value) +
 * aantal gevulde velden + de kop van de zichtbare paginatekst (vangt herordening
 * van niet-interactieve content, bv. productlijsten die alleen in textDigest leven).
 *
 * Doel: een muterende actie die ok=true geeft maar deze afdruk niet verandert,
 * is een verdachte no-op (Run 2: klik slaagt mechanisch, pagina beweegt niet).
 */
export function orderSensitiveFingerprint(snapshot: Snapshot): string {
  const path = (() => {
    try { return new URL(snapshot.url).pathname; } catch { return snapshot.url.slice(0, 80); }
  })();
  const elems = snapshot.nodes
    .slice(0, 12)
    .map((n) => `${n.role}:${n.name.slice(0, 25)}${n.value ? "=" + n.value.slice(0, 20) : ""}`)
    .join("|");
  const filledCount = snapshot.nodes.filter((n) => n.value && n.value.trim()).length;
  const digestHead = (snapshot.textDigest ?? "").slice(0, 200);
  return `${path}||${elems}||f${filledCount}||${digestHead}`;
}

export interface LoopOptions {
  maxSteps?: number;
  /** basis-pauze tussen acties (ms); 0 = geen pauze (tests). Echte runs jitteren hierboven. */
  pacingMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** injecteerbaar voor tests; standaard Math.random */
  random?: () => number;
  log?: (m: string) => void;
  /** wordt elke stap gecheckt; true = run netjes afbreken (bv. tab gesloten) */
  isAborted?: () => boolean;
  /**
   * "confirm" (standaard) = vraag bevestiging bij elke muterende actie.
   * "auto" = doe alles zelf zonder te vragen. LET OP: de harde deny-lijst
   * (/payment, /checkout, ...) blijft óók in "auto" actief en is nooit te omzeilen.
   */
  autonomy?: "confirm" | "auto";
  /** Taal van de agent-antwoorden: "nl" (standaard) of "en". */
  language?: "nl" | "en";
  /** Action-cache voor deterministisch hergebruik zonder LLM-calls. */
  cacheStore?: CacheStore;
  /**
   * Schrijft objectief bewijs (URL, actie, resultaat) per stap naar een bestand.
   * Geeft de buitenste Planner inzicht zonder de loop-logica te wijzigen.
   * Bewijs = feiten: URL + actie + ok/fout + geëxtraheerde tekst. Geen evaluatie.
   */
  stepLogger?: {
    append(e: {
      run: string; step: number; url: string; action: unknown;
      ok: boolean; extracted?: string; detail?: string; ts: number;
    }): void;
  };
  /** Run-ID voor correlatie in de step-log. */
  runId?: string;
  /**
   * Wordt aangeroepen als de loop vastzit (herhaling / aanhoudende onzekerheid).
   * Geeft een herstel-hint terug (string) zodat de loop alternatief kan proberen,
   * of null als er geen plan kwam (timeout → run stopt veilig).
   * Niet ingesteld → terugval op requestConfirm (menselijke bevestiging).
   */
  onStuck?: (reason: StuckReason) => Promise<string | null>;
  /**
   * Optionele geordende checkpoint-lijst voor complexe doelen.
   * Elk checkpoint heeft eigen predicaten die deterministisch bewijzen dat
   * die stap klaar is. De tracker injecteert de huidige stap in de prompt
   * en advance automatisch bij een match. Zie SubstateTracker.
   */
  substates?: Substate[];
  /**
   * Optionele recovery-store. Bevat bewezen herstelplannen per (site, fail-category).
   * escalateOrStop() checkt de store VÓÓR Claude Code te bellen — gratis cache-hit.
   * session.ts schrijft naar de store na een succesvolle run met recovery.
   */
  recoveryStore?: RecoveryStore;
  /**
   * Selector-geheugen: slaat per site op welke (role, name)-elementen succesvol werden gebruikt.
   * Wordt als context-hint aan het model meegegeven zodat het bekende elementen direct herkent.
   * Wordt gevuld na elke geslaagde click/type/select/paste.
   */
  selectorStore?: SelectorStore;
  /**
   * Als true: genereer DONE-predicaten via LLM aan het begin van elke run (als substates leeg zijn).
   * Maakt één extra LLM-aanroep per run maar produceert sterkere done-checks (url-contains ipv text-present).
   * Default: false (opt-in — kost tokens).
   */
  generatePredicates?: boolean;
  /**
   * Aparte router voor Judge-verificatie en predicaat-generatie (bv. een cheap-pool met
   * een klein lokaal model eerst). Ontbreekt hij, dan valt de loop terug op de hoofd-router
   * (`router`-argument), zoals voorheen. Houdt dat werk los van de gratis cloud-quota die het
   * echte plan-werk nodig heeft.
   */
  judgeRouter?: ChatLike;
}

/** URL-patronen die duiden op een loginpagina (voor sessie-verloop detectie). */
const LOGIN_PATH_PATTERNS = [
  /\/log[io]n\b/i,
  /\/sign[_-]?in\b/i,
  /\/inloggen\b/i,
  /\/authenticate\b/i,
  /\/account\/login/i,
];

function isLoginPage(url: string): boolean {
  if (!url) return false;
  try {
    return LOGIN_PATH_PATTERNS.some((p) => p.test(new URL(url).pathname));
  } catch {
    return false;
  }
}

export interface RunOutcome {
  status: RunStatus;
  summary?: string;
  steps: number;
  /** Welk stuck-signaal de run stopte (alleen gevuld bij "gestopt"-einde via escalatie). */
  stuckSignalId?: string;
  /** True als minstens één escalatie-poging een herstelplan opleverde (ook al eindigde de run uiteindelijk gestopt). */
  hadRecovery?: boolean;
}

function refNode(snapshot: Snapshot, action: Action): SnapshotNode | undefined {
  const ref = (action as { ref?: string }).ref;
  if (!ref) return undefined;
  return snapshot.nodes.find((n) => n.ref === ref);
}

/**
 * Bouwt de GateContext waarmee checkDenied()/needsConfirm() (guardrails.ts) een actie
 * beoordelen. Voor de meeste acties is dat gewoon de rol/naam uit de snapshot-node die
 * bij de ref hoort (kan bekend zijn omdat de agent de ref net zelf uit een snapshot koos).
 *
 * click-at (vision-fallback) heeft GEEN ref en dus geen uit de snapshot bekende rol/naam.
 * Restpunt uit de adversariële review 2026-09-13: `clickAtViewportPoint()` (packages/
 * extension/lib/executor.ts) had voorheen alleen de smalle DENY_WORDS-check, geen
 * equivalent van needsConfirm() voor write-rollen in het algemeen — de companion-poort
 * kon voor click-at nooit iets over het doelwit zeggen. Deze functie vraagt de Hand
 * daarom EERST (zonder te klikken, via `resolveOnly:true`) welk element ECHT op die
 * positie staat, zodat de poort hieronder dezelfde write-role/CONFIRM_WORDS/DENY_WORDS-
 * check kan toepassen als bij een gewone klik — VOORDAT er ooit een mens om bevestiging
 * wordt gevraagd of geklikt wordt.
 *
 * Geeft bij een mislukte resolve (geen element op die positie) `resolveFailure` terug in
 * plaats van een ctx, zodat de caller kan afzien van zowel de poort als de echte klik.
 */
export async function buildGateContext(
  hand: Pick<HandBridge, "act">,
  action: Action,
  currentUrl: string,
  node: SnapshotNode | undefined,
): Promise<{ ctx: GateContext; resolveFailure?: ActResult }> {
  if (action.kind !== "click-at") {
    return { ctx: { currentUrl, targetName: node?.name, role: node?.role } };
  }
  let resolveResult: ActResult;
  try {
    resolveResult = await hand.act({ ...action, resolveOnly: true });
  } catch (e) {
    resolveResult = { ok: false, detail: (e as Error).message };
  }
  if (!resolveResult.ok) {
    return { ctx: { currentUrl }, resolveFailure: resolveResult };
  }
  return {
    ctx: {
      currentUrl,
      targetName: resolveResult.resolvedTarget?.name,
      role: resolveResult.resolvedTarget?.role,
    },
  };
}

function describe(action: Action): string {
  switch (action.kind) {
    case "navigate":
      return `Ga naar ${action.url}`;
    case "click":
      return `Klik op ${action.ref}`;
    case "click-at":
      return `Klik op positie (${Math.round(action.xFraction * 100)}%, ${Math.round(action.yFraction * 100)}%) van de screenshot`;
    case "type":
      return `Typ in ${action.ref}${action.submit ? " en verstuur" : ""}`;
    case "paste":
      return `Plak tekst in ${action.ref}${action.submit ? " en verstuur" : ""}`;
    case "hover":
      return `Hover over ${action.ref}`;
    case "keyboard":
      return `Toets ${action.key}${action.ref ? ` op ${action.ref}` : ""}`;
    case "upload":
      return `Upload ${action.filename} naar ${action.ref}`;
    case "upload-local":
      return `Upload lokaal bestand ${action.path} naar ${action.ref}`;
    case "select":
      return `Kies ${action.value} in ${action.ref}`;
    case "extract":
      return `Lees: ${action.what}`;
    case "scroll":
      return `Scroll ${action.direction}${action.amount ? ` (${action.amount}x)` : ""}`;
    case "wait":
      return `Wacht ${action.ms}ms`;
    case "wait-for": {
      const p = action.predicate as { type?: string; value?: string; role?: string } | null;
      const wat = p?.value ?? p?.role ?? p?.type ?? "voorwaarde";
      return `Wacht tot: ${action.reason ?? wat}`;
    }
    case "drag":
      return `Sleep ${action.ref} naar ${action.toRef}`;
    case "right-click":
      return `Rechtermuisklik op ${action.ref}`;
    case "history":
      return action.direction === "back" ? "Ga terug" : "Ga vooruit";
    case "copy":
      return `Kopieer tekst van ${action.ref}`;
    case "finish":
      return action.summary;
  }
}

/**
 * De agent-lus (plan-follower, niet fully-autonomous):
 * waarnemen -> model vraagt 1 actie -> poort (deny/confirm) -> uitvoeren -> herhalen,
 * tot het model 'finish' kiest, de gebruiker afbreekt, of het stappen-plafond is bereikt.
 */
export class AgentLoop {
  private readonly maxSteps: number;
  private readonly pacingMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly log: (m: string) => void;
  private readonly autonomy: "confirm" | "auto";
  private readonly language: "nl" | "en";
  private readonly cacheStore: CacheStore | undefined;
  private readonly stepLogger: LoopOptions["stepLogger"];
  private readonly runId: string;
  private readonly onStuck: ((reason: StuckReason) => Promise<string | null>) | undefined;
  /** Actieve micro-plan buffer. Leeg → LLM aanroepen. Gevuld → volgende stap pakken. */
  private currentPlan: PlannedStep[] = [];
  /** Herstel-hint van Claude Code — geïnjecteerd als REEDS GEPROBEERD-blok in de prompt. */
  private failedHint: string | undefined = undefined;
  /** Screenshot genomen op het moment van vastlopen — geïnjecteerd als vision bij de eerste recovery-aanroep. */
  private failedHintScreenshot: string | undefined = undefined;
  /** Hoeveel keer deze run al om een herstelplan is gevraagd (plafond: MAX_RECOVERY_ATTEMPTS). */
  private recoveryAttempts = 0;
  /** Het laatste stuck-signaal dat de run deed stoppen via give-up (RunRecord-substraat). */
  private _lastStuckSignalId: string | undefined = undefined;
  /** True als minstens één escalatie-poging succesvol een herstelplan ontving (RunRecord-substraat). */
  private _hadRecovery = false;
  /**
   * Of de run eindigde op een finish die de DONE-poort ECHT bevestigde (verdict
   * "match" op minstens één predicaat), niet op een indeterminate die er doorheen
   * glipte. Alleen zo'n run mag de herstel-hints als bewezen wegschrijven en naar het
   * gedeelde brein sturen; anders leert het geheugen van werk dat nooit is gedaan.
   */
  private _verifiedFinish = false;

  /** Bewezen herstel-events van deze run — voor flush naar recovery-store na "klaar". */
  private _provenRecoveries: Array<{ sitePattern: string; failureCategory: string; failureClass?: string; hint: string }> = [];

  /** Provider:model-combinaties die deze run daadwerkelijk antwoord gaven ("groq:llama-3.3-70b-versatile"),
   * in volgorde van eerste gebruik. Ontbrak eerder: een benchmark-run kon niet zeggen welk model een taak
   * echt deed, alleen dat de pool ooit een antwoord teruggaf. */
  private readonly _providersUsed: string[] = [];

  /** Voor RunRecord-substraat: het signaal dat de run liet stoppen via escalatie (undefined bij klaar/max-steps). */
  get lastStuckSignalId(): string | undefined { return this._lastStuckSignalId; }
  /** Voor RunRecord-substraat: had deze run minstens één succesvolle escalatie-herstelpoging? */
  get hadRecovery(): boolean { return this._hadRecovery; }

  /** True als de DONE-poort de finish echt bevestigde ("match"), niet slechts toeliet. */
  get verifiedFinish(): boolean { return this._verifiedFinish; }
  /** Provider:model-combinaties die deze run daadwerkelijk antwoord gaven, in volgorde van eerste gebruik. */
  get providersUsed(): readonly string[] { return this._providersUsed; }
  /** Bewezen recovery-events van deze run (voor flush naar recovery-store na "klaar"). */
  get provenRecoveries(): ReadonlyArray<{ sitePattern: string; failureCategory: string; failureClass?: string; hint: string }> {
    return this._provenRecoveries;
  }

  constructor(
    private readonly router: ChatLike,
    private readonly hand: HandBridge,
    opts: LoopOptions = {},
  ) {
    this.maxSteps = opts.maxSteps ?? 15;
    // Mensachtige basis-pauze (geen robot-1/sec). humanPause() jittert hierboven.
    this.pacingMs = opts.pacingMs ?? 1800;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
    this.log = opts.log ?? (() => {});
    this.isAborted = opts.isAborted ?? (() => false);
    this.autonomy = opts.autonomy ?? "confirm";
    this.language = opts.language ?? "nl";
    this.cacheStore = opts.cacheStore;
    this.stepLogger = opts.stepLogger;
    this.runId = opts.runId ?? "";
    this.onStuck = opts.onStuck;
    this.substates = opts.substates ?? [];
    this.recoveryStore = opts.recoveryStore;
    this.selectorStore = opts.selectorStore;
    this.enablePredicateGen = opts.generatePredicates ?? false;
    this.judgeRouter = opts.judgeRouter ?? router;
  }

  private readonly substates: Substate[];
  private readonly recoveryStore: RecoveryStore | undefined;
  private readonly selectorStore: SelectorStore | undefined;
  private readonly enablePredicateGen: boolean;
  /** Judge-verificatie en predicaat-generatie: cheap-pool als meegegeven, anders de hoofd-router. */
  private readonly judgeRouter: ChatLike;

  private readonly isAborted: () => boolean;

  /**
   * Centrale stuck-escalatie: vraagt Claude Code om een herstelplan.
   * Bewaakt het recovery-plafond om een recovery-lus te voorkomen:
   * "YAD vraagt hulp → plan faalt → vraagt opnieuw → plan varieert maar faalt ook".
   * Geeft de hint-string terug, of null als er geen plan is (timeout / plafond / geen onStuck).
   */
  private async escalate(
    reason: StuckReason,
    attempts: number,
    maxAttempts: number,
  ): Promise<string | null> {
    if (!this.onStuck) return null;
    if (attempts >= maxAttempts) {
      this.log(`recovery-plafond bereikt (${attempts}/${maxAttempts}) — run stopt definitief`);
      return null;
    }
    return this.onStuck(reason);
  }

  /**
   * De ENE escalatie-respons op een stuck-signaal (voorheen 8× gekopieerd door de lus).
   * Een detector levert een {@link Signal}; deze helper doet de I/O: markeer hulp-nodig,
   * vraag Claude Code om een plan, en bij een plan: reset de signaal-specifieke tellers
   * (via de reset-closure), wis het plan en injecteer de hint. Muteert this.failedHint /
   * this.currentPlan / this.recoveryAttempts; de lus-lokale tellers reset de caller.
   *
   * Retourneert:
   *  - "recovered": er kwam een herstelplan; de lus mag door met een andere aanpak.
   *  - "give-up":   geen plan (plafond/timeout, óf geen onStuck-kanaal). De caller
   *                 beslist wat "give-up" betekent (meestal: stop de run).
   */
  private async escalateOrStop(p: {
    signal: Signal;
    step: number;
    url: string;
    lastAction: Action;
    goal: string;
    history: HistoryItem[];
    reset: () => void;
  }): Promise<"recovered" | "give-up"> {
    const { signal, step, url, lastAction, goal, history, reset } = p;
    this.log(`stuck-signaal [${signal.severity}] ${signal.id}: ${signal.evidence}`);

    const sitePattern = (() => { try { return new URL(url).hostname; } catch { return "unknown"; } })();

    // Recovery-store: check VÓÓR Claude Code te bellen — cache-hit = geen LLM-kosten.
    // Drie-laags lookup: tier-1 exact, tier-2 cross-domain zelfde signaal, tier-3 cross-domain zelfde klasse.
    const storedHint = this.recoveryStore?.get(sitePattern, signal.id, signal.signalClass) ?? null;
    const hint = storedHint ?? await (async () => {
      this.hand.update({
        status: "hulp-nodig",
        step,
        message: `${signal.evidence} — Claude Code om herstelplan gevraagd.`,
        action: lastAction,
      });
      return this.escalate(
        { why: signal.id as StuckReason["why"], runId: this.runId, goal, url, lastAction, history },
        this.recoveryAttempts,
        MAX_RECOVERY_ATTEMPTS,
      );
    })();

    if (hint) {
      if (storedHint) {
        this.log(`recovery-store cache-hit (${sitePattern}|${signal.id}) — geen Claude Code nodig`);
        this.hand.update({ status: "bezig", step, message: `Bewezen herstelplan gevonden — andere aanpak…` });
      }
      this.recoveryAttempts++;
      this._hadRecovery = true;
      this._provenRecoveries.push({ sitePattern, failureCategory: signal.id, failureClass: signal.signalClass, hint });
      this.failedHint = hint;
      // Neem screenshot van de vastgelopen pagina als visuele context voor de recovery-aanroep.
      this.failedHintScreenshot = (await this.hand.requestScreenshot().catch(() => null)) ?? undefined;
      reset();
      this.currentPlan = [];
      if (!storedHint) {
        this.hand.update({
          status: "bezig",
          step,
          message: `Herstelplan ontvangen (escalatie ${this.recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS}) — andere aanpak...`,
        });
      }
      return "recovered";
    }
    this._lastStuckSignalId = p.signal.id;
    return "give-up";
  }

  /**
   * Mensachtige, onregelmatige pauze tussen acties. Neemt een optionele basis-ms
   * (voor site-profiel overschrijving); valt terug op this.pacingMs voor tests.
   * Een vaste cadans is een bot-signaal; echte mensen variëren.
   */
  private humanPause(pacingMs?: number): number {
    const base = pacingMs ?? this.pacingMs;
    if (base <= 0) return 0;
    return Math.round(base + this.random() * base * 1.3);
  }

  /**
   * Wacht tot een voorwaarde waar is, in plaats van een vast aantal milliseconden.
   *
   * WAAROM DIT ER MOEST KOMEN: het enige wachtmiddel was `wait: { ms }`, en dat is
   * gokken. Te kort en de agent handelt op een pagina die er nog niet is; te lang en
   * de klant betaalt voor niets. Op een trage site verschuift dat venster ook nog eens
   * per keer, dus een getal dat gisteren werkte faalt vandaag.
   *
   * Een mens wacht niet drie seconden, hij wacht tot de knop er staat. Dat is precies
   * wat dit doet: elke 400 ms een verse snapshot, predicaat toetsen, klaar zodra het
   * klopt. Gemiddeld wordt een taak hierdoor sneller EN betrouwbaarder, omdat de meeste
   * vaste wachttijden veel te ruim zijn gekozen uit voorzichtigheid.
   *
   * Het predicaat komt uit dezelfde taal die de agent al gebruikt voor
   * state-correctness, dus er valt niets nieuws te leren en de evaluator is al getest.
   *
   * `indeterminate` telt bewust NIET als klaar. Tekst-predicaten kunnen "niet gevonden"
   * teruggeven puur omdat de tekstsamenvatting is afgekapt; daarop stoppen zou een
   * valse voltooiing zijn. Bij twijfel wachten we door tot de tijd op is.
   */
  private async waitForCondition(action: Action & { kind: "wait-for" }): Promise<ActResult> {
    const pred = parsePredicate(action.predicate);
    if (!pred) {
      return { ok: false, detail: `wait-for: onleesbaar predicaat ${JSON.stringify(action.predicate).slice(0, 120)}` };
    }
    // Plafond op 60s: langer wachten is bijna altijd een verkeerde aanname over de
    // pagina, en dan wil je een eerlijke mislukking zien in plaats van een agent die
    // minutenlang stil lijkt te hangen.
    const timeoutMs = Math.min(Math.max(action.timeoutMs ?? 15_000, 500), 60_000);
    const startedAt = Date.now();
    let rondes = 0;

    while (Date.now() - startedAt < timeoutMs) {
      // Zonder deze check kon een gebruiker op Stop klikken (of de tab sluiten) en
      // moest hij alsnog tot de volle timeout (tot 60s) wachten voor de run echt
      // ophield te draaien — de enige bestaande isAborted-check zat vóór deze functie
      // aangeroepen werd, niet erin.
      if (this.isAborted()) {
        return { ok: false, detail: "afgebroken tijdens wachten" };
      }
      let snap: Snapshot;
      try {
        snap = await this.hand.requestSnapshot();
      } catch (e) {
        // Een enkele mislukte snapshot is geen reden om op te geven; de pagina kan
        // midden in een navigatie zitten. Doorproberen tot de tijd op is.
        await this.sleep(400);
        rondes++;
        continue;
      }
      rondes++;
      if (evaluatePredicate(pred, snap) === "match") {
        const ms = Date.now() - startedAt;
        return { ok: true, detail: `voorwaarde werd waar na ${ms}ms (${rondes} controles)` };
      }
      await this.sleep(400);
    }

    const ms = Date.now() - startedAt;
    return {
      ok: false,
      detail: `wait-for liep af na ${ms}ms zonder dat "${pred.type}" waar werd (${rondes} controles)`,
    };
  }

  async run(goal: string, maxStepsOverride?: number, attachments?: Attachment[]): Promise<RunOutcome> {
    const maxSteps = Math.min(maxStepsOverride ?? this.maxSteps, 40);
    const history: HistoryItem[] = [];
    this.hand.update({ status: "plannen", message: `Doel: ${goal}` });

    this.currentPlan = []; // reset per run — vorige plan-rest nooit meenemen
    this.failedHint = undefined; // reset per run
    this.failedHintScreenshot = undefined; // reset per run
    this.recoveryAttempts = 0; // reset per run — escalatie-plafond geldt per run
    this._lastStuckSignalId = undefined; // reset per run
    this._hadRecovery = false; // reset per run
    this._provenRecoveries = []; // reset per run
    this._providersUsed.length = 0; // reset per run — readonly array-ref, dus leegmaken i.p.v. herbinden
    let parseFails = 0;
    let cleanRun = true; // false zodra er een parse-fout is geweest; vuile runs worden niet gecached.
    let lastActionSig = "";
    let repeatCount = 0;
    // Alternerende ref-detectie: A→B→A→B→... zonder URL-change is een stuck-signaal.
    // prevSig = de actie van 2 stappen geleden; als huidige sig == prevSig én ≠ lastActionSig
    // → zit de agent in een 2-cycluslus (e14→e10→e14→e10...).
    let prevSig = "";
    let alternateCount = 0;
    let lastTier = "";
    // Judge: telt opeenvolgende "unknown"-verdicts. Bij 3 → escaleer naar mens.
    // Reset automatisch als de URL verandert — URL-change = voortgang, niet vastzitten.
    let consecutiveUnknowns = 0;
    let lastKnownUrl = "";
    // Geëxtraheerde informatie tijdens de run; dit wordt het eind-antwoord aan de
    // gebruiker. Zonder dit ziet de mens alleen "klaar" en niet wat er gevonden is.
    const findings: string[] = [];
    // Telt opeenvolgende act()-mislukkingen (ongeacht welke actie). Browser weigert
    // acties wanneer DOM drastisch veranderd is (drift) of een modal alles blokkeert.
    let consecutiveActFailures = 0;
    // State Loop: circular buffer van fingerprints. Als de huidige staat eerder is
    // gezien (>=4 stappen geleden), zit de agent in een lus.
    const stateHistory: string[] = [];
    // No Progress: telt LLM-aanroepen zonder bewijs van voortgang (judge "match" of
    // succesvolle actie). Bij 6+ aanroepen zonder vooruitgang → stop met tokens verbranden.
    let llmCallsSinceProgress = 0;
    // Recovery-plafond leeft nu als instance-field (this.recoveryAttempts) + module-const
    // MAX_RECOVERY_ATTEMPTS, zodat escalateOrStop() het kan lezen/ophogen.
    // Goal Drift: telt opeenvolgende LLM-aanroepen op hetzelfde URL-pad.
    // Na 3+ aanroepen op dezelfde URL → Judge-check of agent richting doel gaat.
    // Goedkoop alternatief voor goal-proximity: 1 judge-call per 3 LLM-calls op zelfde URL.
    let consecutiveSameUrlLlmCalls = 0;
    let lastLlmCallUrl = "";
    // URL-regressie: bijhouden welke paden al bezocht zijn.
    // Terugkeer naar een al-bezochte URL na tussentijds een ander pad = objectief bewijs van afdwaling.
    const uniquePathsSeen = new Set<string>();
    let urlRegressionCount = 0;
    // Extract-lus bewaker (code-niveau): telt opeenvolgende extract-acties op dezelfde URL.
    // Na 2 extracts op dezelfde URL → forceer finish (model heeft de data al; extra lezen helpt niet).
    // Click/navigate/type/select resetten de teller; wait en scroll niet (passief).
    let consecutiveSameUrlExtracts = 0;
    let lastExtractUrl = "";
    // Effect-nul-detector (lost stil falen op — Run 2): een muterende actie (click/type/select)
    // die ok=true geeft maar de pagina niet verandert, is een verdachte no-op. We onthouden de
    // volgorde-gevoelige fingerprint VÓÓR de actie en vergelijken hem met de snapshot van de
    // VOLGENDE iteratie. Identiek = geen waarneembaar effect. Anders dan de andere tellers reset
    // deze NIET op het mechanische actie-type, maar alleen op een ECHT waargenomen verandering.
    let stepsSinceRealEffect = 0;
    let pendingEffectCheck: { pre: string; step: number } | null = null;
    const MAX_NO_EFFECT = 3;
    // Onverwachte-navigatie-detector: een klik op een niet-link element die de URL verandert.
    // lastNonLinkClickUrl = URL VÓÓR de klik; lastNonLinkClickRole = role van het element.
    let lastNonLinkClickUrl = "";
    let lastNonLinkClickRole = "";
    // DONE-predicaat bewaker: telt hoeveel keer een finish-poging is geblokkeerd.
    // Na 2 weigeringen stopt de loop — voorkomt oneindige weiger-loop.
    let finishRejections = 0;
    const MAX_FINISH_REJECTIONS = 2;

    // Startpagina ophalen voor cache-sleutel, optionele replay en predicate-generatie.
    let startingUrl = "";
    let loopStartStep = 1;
    let initSnap: Snapshot | undefined;
    try {
      initSnap = await this.hand.requestSnapshot();
      startingUrl = initSnap.url;
    } catch { /* snapshot mislukt → gewoon zonder cache */ }

    // Predicate-generator: genereer DONE-predicaten via LLM als substates leeg zijn (opt-in).
    // Eén extra LLM-aanroep per run, maar produceert sterkere done-checks (url-contains ipv text-present).
    const effectiveSubstates: Substate[] = [...this.substates];
    if (effectiveSubstates.length === 0 && this.enablePredicateGen && initSnap) {
      try {
        const generated = await generatePredicates(this.judgeRouter as PredicateChat, goal, initSnap);
        if (generated.length > 0) {
          effectiveSubstates.push(...generated);
          this.log(`predicate-gen: ${generated.length} substate(s) aangemaakt → "${effectiveSubstates[0]?.label}"`);
        }
      } catch { /* graceful degradation — geen predicaten is ok, run gaat gewoon door */ }
    }
    const tracker = new SubstateTracker(effectiveSubstates);

    if (this.cacheStore && startingUrl) {
      const cacheKey = makeCacheKey(goal, startingUrl);
      const cached = this.cacheStore.get(cacheKey);
      if (cached) {
        this.log(`cache-hit: "${cached.goalPreview}" (${cached.actions.length} stappen, ${cached.hitCount} hits)`);
        this.hand.update({
          status: "bezig",
          message: `Herhaalde taak — ${cached.actions.length} stappen opnieuw afspelen via cache…`,
        });
        const replay = await replayCache(
          cached,
          // `wait-for` moet ook hier langs de lus-afhandeling. replayCache praat
          // rechtstreeks met de Hand, en die kent deze actie niet: er valt in de pagina
          // niets uit te voeren, we kijken alleen of een voorwaarde inmiddels waar is.
          // Zonder deze omleiding zou een herhaalde taak uit de cache erop stukvallen.
          (a) => (a.kind === "wait-for" ? this.waitForCondition(a) : this.hand.act(a)),
          (msg, step, action) => this.hand.update({ status: "bezig", step, message: msg, action }),
        );
        this.cacheStore.hit(cacheKey);
        if (replay.status === "complete") {
          const summary = cached.summary ?? `Taak voltooid via cache — ${cached.actions.length} stappen, 0 LLM-calls.`;
          this.hand.update({ status: "klaar", message: summary });
          return { status: "klaar", summary, steps: cached.actions.length };
        }
        // Drift: prefill history met de geslaagde stappen; LLM-loop neemt over vanaf driftpunt.
        history.push(...replay.completedSteps);
        loopStartStep = (replay.driftAt ?? replay.completedSteps.length) + 1;
        this.log(`cache-drift op stap ${loopStartStep}: LLM-loop neemt over`);
        this.hand.update({ status: "bezig", message: `Site veranderd op stap ${loopStartStep} — AI neemt het over.` });
      }
    }

    for (let step = loopStartStep; step <= maxSteps; step++) {
      let snapshot: Snapshot;
      try {
        snapshot = await this.hand.requestSnapshot();
      } catch (e) {
        this.hand.update({ status: "fout", step, message: `Kon de pagina niet lezen: ${(e as Error).message}` });
        return { status: "fout", steps: step - 1 };
      }

      if (this.isAborted()) {
        this.hand.update({ status: "gestopt", step, message: "Run afgebroken (bijvoorbeeld: tab gesloten)." });
        return { status: "gestopt", steps: step - 1 };
      }

      // URL veranderd → echte navigatie = voortgang. Reset alle voortgangstellers.
      if (lastKnownUrl && snapshot.url !== lastKnownUrl) {
        if (consecutiveUnknowns > 0) this.log(`URL veranderd → unknown-teller gereset (was ${consecutiveUnknowns})`);
        consecutiveUnknowns = 0;
        llmCallsSinceProgress = 0;
        consecutiveSameUrlLlmCalls = 0;
        lastLlmCallUrl = "";
        stateHistory.length = 0; // nieuwe URL = nieuw staat-geheugen

        // URL-regressie: check of het nieuwe pad al eerder is bezocht.
        // Een enkelvoudige terugkeer is normaal (bijv. productpagina → inventaris);
        // meerdere regressies duiden op afdwaling. Drempel: 2 regressies → escaleer.
        // Gaat pas in na stap 3 om false positives bij login-omleiding te vermijden.
        if (step > 3) {
          const newPath = (() => { try { return new URL(snapshot.url).pathname; } catch { return snapshot.url.slice(0, 80); } })();
          if (uniquePathsSeen.has(newPath)) {
            urlRegressionCount++;
            this.log(`url-regressie #${urlRegressionCount}: terug naar pad ${newPath}`);
            if (urlRegressionCount >= 2) {
              const r = await this.escalateOrStop({
                signal: makeSignal("url-regression", `URL-regressie: terug naar al-bezochte pagina ${newPath}`),
                step, url: snapshot.url,
                lastAction: (history.at(-1) ?? { action: { kind: "wait", ms: 0 } }).action,
                goal, history,
                reset: () => { urlRegressionCount = 0; uniquePathsSeen.clear(); },
              });
              if (r === "give-up") {
                this.hand.update({ status: "gestopt", step, message: "Run gestopt — URL-regressie, geen herstelplan." });
                return { status: "gestopt", steps: step };
              }
            }
          }
          uniquePathsSeen.add(newPath);
        }

        // Onverwachte-navigatie: klik op niet-link element veroorzaakte URL-verandering.
        // lastNonLinkClickUrl bevat de URL vóór de klik; als die gelijk is aan lastKnownUrl
        // (= URL van de vorige iteratie), dan was de URL-change een gevolg van die klik.
        if (lastNonLinkClickUrl && lastNonLinkClickUrl === lastKnownUrl) {
          const prevUrl = lastNonLinkClickUrl;
          const prevRole = lastNonLinkClickRole;
          lastNonLinkClickUrl = "";
          lastNonLinkClickRole = "";
          this.log(`onverwachte navigatie: click op "${prevRole}" bracht ons van ${prevUrl} naar ${snapshot.url}`);
          const r = await this.escalateOrStop({
            signal: makeSignal("unintended-navigation",
              `Klik op ${prevRole || "element"} veroorzaakte onverwachte navigatie van ${prevUrl} naar ${snapshot.url} — herstel: navigate terug naar ${prevUrl}`),
            step, url: snapshot.url,
            lastAction: (history.at(-1) ?? { action: { kind: "wait", ms: 0 } }).action,
            goal, history,
            reset: () => { /* tracking-vars al gewist vóór escalatie */ },
          });
          if (r === "give-up") {
            this.hand.update({ status: "gestopt", step, message: "Run gestopt — onverwachte navigatie, geen herstelplan." });
            return { status: "gestopt", steps: step };
          }
        } else {
          lastNonLinkClickUrl = "";
          lastNonLinkClickRole = "";
        }
      }
      // Registreer het startpad eenmalig (eerste iteratie)
      if (!lastKnownUrl && uniquePathsSeen.size === 0) {
        try { uniquePathsSeen.add(new URL(snapshot.url).pathname); } catch { /* skip */ }
      }
      lastKnownUrl = snapshot.url;

      // Substate-tracker: check of de huidige tussenstap klaar is en advance als dat zo is.
      if (tracker.hasSubstates && tracker.tryAdvance(snapshot)) {
        const p = tracker.progress;
        if (p && !p.isComplete) {
          this.log(`substate-advance → stap ${p.currentIndex + 1}/${p.totalCount}: ${p.currentLabel}`);
        } else {
          this.log(`substate-advance → alle ${tracker.progress?.totalCount ?? 0} tussenstap(pen) voltooid`);
        }
      }

      // Effect-nul-detectie: was de vorige muterende actie een no-op? Vergelijk de
      // volgorde-gevoelige fingerprint van vóór die actie met de huidige snapshot.
      // Dit vangt STIL FALEN (Run 2): klik/typ/select geeft ok=true maar de pagina
      // beweegt niet — de agent klikt verkeerde/dode elementen zonder het te merken.
      if (pendingEffectCheck) {
        const post = orderSensitiveFingerprint(snapshot);
        if (post === pendingEffectCheck.pre) {
          stepsSinceRealEffect++;
          this.log(`effect-nul: muterende actie (stap ${pendingEffectCheck.step}) veranderde de pagina niet (${stepsSinceRealEffect}/${MAX_NO_EFFECT})`);
        } else {
          stepsSinceRealEffect = 0;
        }
        pendingEffectCheck = null;
        if (stepsSinceRealEffect >= MAX_NO_EFFECT) {
          const r = await this.escalateOrStop({
            signal: makeSignal("silent-no-effect", `Stil falen: ${stepsSinceRealEffect} muterende acties zonder waarneembaar effect`),
            step, url: snapshot.url,
            lastAction: (history.at(-1) ?? { action: { kind: "wait", ms: 0 } }).action,
            goal, history,
            reset: () => { stepsSinceRealEffect = 0; urlRegressionCount = 0; uniquePathsSeen.clear(); },
          });
          if (r === "give-up") {
            this.hand.update({ status: "gestopt", step, message: "Run gestopt — muterende acties zonder waarneembaar effect, geen herstelplan." });
            return { status: "gestopt", steps: step };
          }
        }
      }

      // State Loop detectie: fingerprint van de huidige browser-staat.
      // Als we hier al eerder waren (>=4 stappen geleden) en geen vooruitgang hadden,
      // zit de agent in een lus van verschillende acties op steeds dezelfde pagina.
      // orderSensitiveFingerprint i.p.v. snapshotFingerprint: sort/filter-acties veranderen
      // de DOM-volgorde en mogen NIET als "dezelfde staat" gezien worden.
      const fingerprint = orderSensitiveFingerprint(snapshot);
      const prevIdx = stateHistory.lastIndexOf(fingerprint);
      if (prevIdx !== -1 && stateHistory.length - prevIdx >= 4 && llmCallsSinceProgress >= 2) {
        this.log(`state-loop: fingerprint gezien ${stateHistory.length - prevIdx} stappen geleden`);
        const r = await this.escalateOrStop({
          signal: makeSignal("state-loop", "State-lus: zelfde pagina teruggekeerd na andere acties"),
          step, url: snapshot.url,
          lastAction: (history.at(-1) ?? { action: { kind: "wait", ms: 0 } }).action,
          goal, history,
          reset: () => { llmCallsSinceProgress = 0; stateHistory.length = 0; urlRegressionCount = 0; uniquePathsSeen.clear(); },
        });
        if (r === "give-up") {
          this.hand.update({ status: "gestopt", step, message: "Run gestopt — state-lus, geen herstelplan." });
          return { status: "gestopt", steps: step };
        }
      }
      // Voeg huidige fingerprint toe aan history (max 20 entries, oldest-first)
      stateHistory.push(fingerprint);
      if (stateHistory.length > 20) stateHistory.shift();

      const tierOverride = snapshot.siteProfileOverride as SiteTier | undefined;
      const profile = tierOverride ? getProfileByTier(tierOverride) : getSiteProfile(snapshot.url);
      if (profile.tier !== lastTier) {
        lastTier = profile.tier;
        this.log(`site-profiel: ${profile.tier} (${snapshot.url})`);
        if (profile.tier === "stealth") {
          this.hand.update({
            status: "bezig",
            step,
            message: "Voorzichtiger tempo — anti-bot detectie actief op deze site.",
          });
        }
      }

      // Hercontrole op de WERKELIJKE URL: een neutraal gelabelde klik kan op een
      // betaal-/bestel-pagina zijn beland. Dan stoppen we de run hard.
      if (pathIsDenied(snapshot.url)) {
        this.hand.update({
          status: "geweigerd",
          step,
          message: "Op een betaal-/bestel-pagina beland; de run is gestopt.",
        });
        return { status: "geweigerd", steps: step - 1 };
      }

      // Sessie-verloop detectie: als we halverwege een run op een loginpagina belanden,
      // is de sessie waarschijnlijk verlopen. We pauzeren en vragen de gebruiker te herinloggen.
      // In auto-modus slaan we deze check over — de agent navigeert bewust naar loginpagina's
      // om zelf in te loggen (bijv. SimScale signin). Menselijke pauze is dan contraproductief.
      if (step > 1 && isLoginPage(snapshot.url) && this.autonomy !== "auto") {
        this.hand.update({
          status: "bezig",
          step,
          message: "Sessie verlopen — doorgestuurd naar de loginpagina. Log handmatig in en bevestig om door te gaan.",
        });
        const dummy: Action = { kind: "wait", ms: 0 };
        const approved = await this.hand.requestConfirm(
          dummy,
          "Sessie verlopen. Log in op de site en klik op Goedkeuren om de taak te hervatten, of op Weigeren om te stoppen.",
        );
        if (!approved) {
          this.hand.update({ status: "gestopt", step, message: "Run gestopt wegens verlopen sessie (door gebruiker geannuleerd)." });
          return { status: "gestopt", steps: step - 1 };
        }
        // Gebruiker is ingelogd — verse snapshot ophalen en doorgaan.
        this.hand.update({ status: "bezig", step, message: "Inloggen bevestigd — taak wordt hervat." });
        continue;
      }

      // LLM alleen aanroepen als het plan leeg is.
      // Bevat het plan nog stappen? Volgende pakken zonder model-aanroep.
      // Dit is de kern van microPlan: 1 LLM-call dekt 1-3 browser-acties.
      if (this.currentPlan.length === 0) {
        // Goal Drift detectie (Layer 2 — state correctness):
        // Na 5 opeenvolgende LLM-aanroepen op hetzelfde URL-pad vraagt de Judge of
        // de agent nog richting het doel gaat. Goedkoop: maxTokens=80, temperature=0,
        // alleen bij "mismatch" (niet bij "unknown") → weinig noise-risico.
        // Drempel 5 (was 3): echte sites hebben setup nodig (cookie-banner, Cloudflare,
        // popup sluiten, eerste scroll) vóór de taak zelf begint.
        if (snapshot.url === lastLlmCallUrl) {
          consecutiveSameUrlLlmCalls++;
        } else {
          consecutiveSameUrlLlmCalls = 0;
          lastLlmCallUrl = snapshot.url;
        }
        if (consecutiveSameUrlLlmCalls >= 5) {
          // Stuur de werkelijke acties naar de judge — niet alleen de lege "detail"-string.
          const recentActions = history
            .slice(-6)
            .map((h) => `${JSON.stringify(h.action)} -> ${h.ok ? "ok" : "FAILED"}`)
            .join("\n");
          const driftCheck = await callJudge(this.judgeRouter, {
            expected: `The agent is making legitimate progress toward: "${goal.slice(0, 120)}". NOTE: All of the following count as valid progress — NOT drift: (1) setup actions (accepting cookie banners, closing popups, scrolling, handling Cloudflare/consent screens), (2) filling form fields (successful type/paste/select actions when the goal involves submitting a form), (3) reading/extracting page content when the goal requires specific information.`,
            url: snapshot.url,
            extracted: recentActions || undefined,
            hadEffect: history.slice(-6).some((h) => h.ok),
          });
          this.log(`goal-drift check (${consecutiveSameUrlLlmCalls} calls op ${snapshot.url}): ${driftCheck.verdict} — ${driftCheck.evidence.slice(0, 120)}`);
          if (driftCheck.verdict === "mismatch") {
            const r = await this.escalateOrStop({
              signal: makeSignal("goal-drift", `Goal drift: ${consecutiveSameUrlLlmCalls} AI-aanroepen op ${snapshot.url} zonder aantoonbare doelvoortgang`),
              step, url: snapshot.url,
              lastAction: (history.at(-1) ?? { action: { kind: "wait", ms: 0 } }).action,
              goal, history,
              reset: () => { consecutiveSameUrlLlmCalls = 0; lastLlmCallUrl = ""; urlRegressionCount = 0; uniquePathsSeen.clear(); },
            });
            if (r === "give-up") {
              this.hand.update({ status: "gestopt", step, message: "Run gestopt — goal drift, geen herstelplan." });
              return { status: "gestopt", steps: step };
            }
          }
          // "unknown" = twijfel → geen escalatie, gewoon doorgaan (anti-noise)
          // "match" = voortgang bevestigd → reset counter
          if (driftCheck.verdict === "match") consecutiveSameUrlLlmCalls = 0;
        }
        lastLlmCallUrl = snapshot.url;

        // No Progress detectie: als we 6+ LLM-aanroepen hebben gedaan zonder dat de
        // judge ooit "match" zei, maakt YAD geld en tokens op zonder richting het doel te gaan.
        llmCallsSinceProgress++;
        if (llmCallsSinceProgress >= 6) {
          this.log(`no-progress: ${llmCallsSinceProgress} LLM-aanroepen zonder voortgang`);
          const r = await this.escalateOrStop({
            signal: makeSignal("no-progress", `Geen meetbare voortgang na ${llmCallsSinceProgress} AI-aanroepen`),
            step, url: snapshot.url,
            lastAction: (history.at(-1) ?? { action: { kind: "wait", ms: 0 } }).action,
            goal, history,
            reset: () => { llmCallsSinceProgress = 0; urlRegressionCount = 0; uniquePathsSeen.clear(); },
          });
          if (r === "give-up") {
            this.hand.update({ status: "gestopt", step, message: `Run gestopt — ${llmCallsSinceProgress} aanroepen zonder voortgang.` });
            return { status: "gestopt", steps: step };
          }
        }

        let content: string;
        let sawScreenshotThisTurn = false;
        try {
          const screenshot = this.failedHintScreenshot;
          sawScreenshotThisTurn = !!screenshot;
          this.failedHintScreenshot = undefined; // eenmalig gebruik — na deze aanroep niet meer meesturen
          const selectorHint = this.selectorStore
            ? (this.selectorStore.getHints(hostnameOf(snapshot.url), pathOf(snapshot.url), snapshot) ?? undefined)
            : undefined;
          content = await this.chatWithRetry(goal, snapshot, history, step, attachments, this.failedHint, tracker.toHint() ?? undefined, screenshot, selectorHint);
        } catch (e) {
          const message = friendlyLlmError(e);
          this.hand.update({ status: "fout", step, message });
          return { status: "fout", steps: step - 1, summary: message };
        }

        const planResult = parseMicroPlan(content);
        if (!planResult.ok) {
          parseFails++;
          cleanRun = false;
          this.log(`plan parse-fout: ${planResult.error}`);
          history.push({ action: { kind: "wait", ms: 0 }, ok: false, detail: `plan parse-fout (${planResult.error})` });
          if (parseFails >= 3) {
            this.hand.update({ status: "fout", step, message: "Model bleef onleesbare plannen geven." });
            return { status: "fout", steps: step };
          }
          continue;
        }
        // click-at is een vision-fallback: alleen geldig op de beurt waarin het model
        // ZELF net een screenshot kreeg. Zonder screenshot heeft het model geen
        // gegronde basis voor pixel-coordinaten — code-niveau afgedwongen, niet
        // alleen via prompt-instructie, want dit moet ook in "auto"-modus gelden.
        if (!sawScreenshotThisTurn && planResult.plan.steps.some((s) => s.action.kind === "click-at")) {
          parseFails++;
          cleanRun = false;
          this.log("plan geweigerd: click-at zonder screenshot deze beurt");
          history.push({ action: { kind: "wait", ms: 0 }, ok: false, detail: "click-at geweigerd — geen screenshot deze beurt" });
          if (parseFails >= 3) {
            this.hand.update({ status: "fout", step, message: "Model bleef click-at proberen zonder screenshot." });
            return { status: "fout", steps: step };
          }
          continue;
        }
        parseFails = 0;
        this.currentPlan = [...planResult.plan.steps];
        this.log(`microPlan (${this.currentPlan.length} stap${this.currentPlan.length !== 1 ? "pen" : ""}): ${planResult.plan.rationale.slice(0, 80)}`);
      }

      // Precies het gat dat de Stop-knop machteloos maakte: een microPlan bevat 1-3
      // al-besloten acties die geen nieuwe modelaanroep meer nodig hebben, dus de
      // uitgaven-poort (waar Stop eerder alleen op inhaakte) komt hier nooit aan te
      // pas. Zonder deze check voerde een reeds-gebufferde actie, inclusief een
      // schrijvende actie zoals "Opslaan", gewoon door na een Stop-klik.
      if (this.isAborted()) {
        this.hand.update({ status: "gestopt", step, message: "Gestopt door de gebruiker." });
        return { status: "gestopt", steps: step };
      }
      const planned = this.currentPlan.shift();
      if (!planned) continue; // defensief — zou nooit mogen
      let action = planned.action;
      const expectedOutcome = planned.expected;

      // Compare/rank/count-bewaker (code-niveau): zie COMPARE_RANK_COUNT_PATTERN hierboven.
      // Strip een meegegeven ref zodat de Hand de volledige paginatekst leest i.p.v. één
      // (mogelijk verkeerd) element — de veilige aanpak die de prompt al voorschrijft.
      if (action.kind === "extract" && action.ref && isCompareRankCountGoal(goal)) {
        this.log(`compare/rank/count-bewaker: extract met ref ${action.ref} op vergelijk-vraag — ref verwijderd, volledige pagina lezen`);
        action = { kind: "extract", what: action.what };
      }

      if (action.kind === "finish") {
        // DONE-predicate check (Step 4): reject the finish unless the snapshot
        // objectively confirms the goal. Prevents false "done" (Run 1: model called
        // finish but the sort/checkout was not actually completed).
        //
        // prompt.ts's own DONE PREDICATES section tells the model to omit "done" ONLY
        // for "purely informational goals (reading/extracting text where no page state
        // changes)" (decision-tree item 6: "No verifiable end state (pure extraction)?
        // -> omit done"), and separately documents text-present/text-absent as "WEAK:
        // ... never rejects". The gate below is built to honor both of those, or a
        // model correctly following its own system prompt would get a legitimately
        // completed run rejected:
        //
        //   - An empty/omitted done array is judged against what this run actually
        //     DID, not treated as an automatic failure. If the run performed a
        //     state-changing action (click/type/select/etc, see
        //     DONE_REQUIRED_ACTION_KINDS) and still supplies no done predicates, that
        //     IS the original false-"klaar" bug (PROMPT-FIX-VALSE-KLAAR.md: the model
        //     claimed a HackerOne asset click / weakness-menu selection had happened
        //     with zero objective proof) -- reject, same as a failed verification. If
        //     the run never did anything but read the page (extract/wait/scroll),
        //     there is nothing to verify and prompt.ts explicitly tells the model to
        //     omit done here -- accept.
        //   - A non-empty done array is evaluated for real: "mismatch" (a predicate
        //     the model itself chose is objectively contradicted by the fresh
        //     snapshot) always rejects. "indeterminate" can only happen via a weak
        //     text-present/text-absent predicate (evaluatePredicates never returns
        //     indeterminate for a non-empty set otherwise -- see predicate.ts), which
        //     prompt.ts documents as "never rejects" -- so it is accepted, not
        //     rejected. Rejecting it would both contradict that live documentation
        //     and, per the retry hint's own old wording, push the model toward
        //     fabricating a falsely-stronger predicate just to pass the gate.
        const donePreds = planned.done ?? [];
        const stateChanged = hasStateChangingAction(history);
        // Observability: log the finish moment so the step-log shows whether the model
        // sent DONE predicates. Without this, finish was invisible in the log.
        if (this.stepLogger) {
          this.stepLogger.append({
            run: this.runId, step, url: snapshot.url,
            action: { kind: "_finish", donePredicates: donePreds.length },
            ok: true, detail: `finish planned - ${donePreds.length} DONE predicate(s)`,
            ts: Date.now(),
          });
        }
        const doneResult = evaluatePredicates(donePreds, snapshot);
        // Reject when: (a) no predicates were supplied for a run that DID change
        // state (the real bug), (b) predicates were supplied and one of them is a
        // hard mismatch, or (c) the goal explicitly asked for an action and NEITHER
        // any state change NOR any DONE predicate backs up the finish. Without (c),
        // "nothing happened" on a write goal reads as informational, the same
        // carve-out meant for "what is the title of this page?" -- which is exactly
        // how a "plaats een reactie" goal reached status "klaar" with zero actions
        // taken and zero predicates supplied (2026-09-07, PROBE G).
        //
        // (c) is deliberately narrow: only fires when the goal itself uses an
        // explicit action verb, so a genuinely informational goal is never rejected
        // by this branch, only a write goal that produced no evidence at all.
        const writeGoalWithNoEvidence = donePreds.length === 0 && !stateChanged && isWriteGoal(goal);
        const rejected = donePreds.length === 0
          ? (stateChanged || writeGoalWithNoEvidence)
          : doneResult.verdict === "mismatch";
        // Observability: log the DONE-check verdict (match/mismatch/indeterminate)
        // including the predicates that were evaluated.
        if (this.stepLogger) {
          this.stepLogger.append({
            run: this.runId, step, url: snapshot.url,
            action: { kind: "_done-check", verdict: doneResult.verdict, matched: doneResult.matched, total: doneResult.total },
            ok: !rejected,
            detail: `DONE ${doneResult.verdict} (${doneResult.matched}/${doneResult.total}), stateChanged=${stateChanged}: ${donePreds.map((p) => JSON.stringify(p)).join(", ")}`,
            ts: Date.now(),
          });
        }
        if (rejected) {
          finishRejections++;
          const evidence = donePreds.length === 0
            ? `no DONE predicates were supplied for a run that performed a state-changing action, URL: ${snapshot.url}`
            : `DONE predicates ${doneResult.verdict} (${doneResult.matched}/${doneResult.total} matched), URL: ${snapshot.url}`;
          this.log(`finish rejected #${finishRejections}: ${evidence}`);
          if (finishRejections <= MAX_FINISH_REJECTIONS) {
            if (donePreds.length === 0) {
              // Tell the model the real reason (missing array), not a false
              // "predicates failed" message -- there were no predicates to fail.
              this.failedHint = `You called finish with no "done" array after performing an action that changes page or form state (click/type/select/etc). A finish call after such an action must include at least one DONE predicate that objectively proves the page confirms the goal, otherwise verification is skipped entirely and the run cannot be trusted. Add a "done" array (see the predicate grammar for the available types, e.g. url-contains, role-present) that matches this goal's completion state, then call finish again WITH that array.`;
            } else {
              // Give the model the exact unconfirmed predicates so it knows which
              // concrete step is still missing (e.g. "navigate to ?sort=hilo").
              const notedPreds = donePreds
                .map((p, i) => `[${i + 1}] ${JSON.stringify(p)}`)
                .join(", ");
              this.failedHint = `You called finish but the page does not confirm the goal. ${evidence}. Predicates: ${notedPreds}. Perform the missing browser steps so the page satisfies these predicates, then call finish again WITH the same (or improved) done array -- do not omit it, omitting it skips verification entirely.`;
            }
            this.currentPlan = [];
            this.hand.update({ status: "bezig", step, message: `Finish rejected - ${evidence}` });
            continue;
          }
          // Rejection ceiling reached: stop to avoid an infinite rejection loop.
          // "gestopt" (stopped) instead of "fout" (error): the task may be mostly
          // done already -- the recovery-store can still learn from this later.
          this.hand.update({ status: "gestopt", step, message: `Finish rejected ${finishRejections}x - ${evidence}` });
          return { status: "gestopt", steps: step };
        }
        this.log(`finish accepted: DONE ${doneResult.verdict} (${doneResult.matched}/${doneResult.total}), stateChanged=${stateChanged}`);
        // Alleen een echte "match" telt als bewijs. Een "indeterminate" wordt bewust
        // doorgelaten (een run mag niet vastlopen op een predicaat dat niets kon
        // vaststellen), maar hij mag het geheugen niet voeden: op 2026-09-07 zette een
        // reeks onbevestigde YouTube-runs zeven onzin-hints als "bewezen" in
        // data/recovery-store.jsonl, en stuurde die ook naar het gedeelde brein.
        this._verifiedFinish = doneResult.verdict === "match" && doneResult.matched > 0;

        const answer = composeAnswer(action.summary, findings);
        this.hand.update({ status: "klaar", step, message: answer, action });
        // Write to cache: only for clean runs with real steps (no parse errors).
        if (this.cacheStore && startingUrl && cleanRun && history.length > 0) {
          const cacheKey = makeCacheKey(goal, startingUrl);
          const existing = this.cacheStore.get(cacheKey);
          this.cacheStore.set({
            key: cacheKey,
            goalPreview: goal.slice(0, 120),
            urlPattern: urlToPattern(startingUrl),
            actions: history.map((h) => h.action),
            summary: answer,
            savedAt: Date.now(),
            totalRuns: (existing?.totalRuns ?? 0) + 1,
          });
          this.log(`cache saved: ${history.length} step(s) for "${goal.slice(0, 40)}"`);
        }
        return { status: "klaar", summary: answer, steps: step };
      }

      // Veiligheidsklep tegen quota-verbrandende lussen: herhaalt het model exact
      // dezelfde actie, dan zit het vast (bv. 8x op dezelfde knop klikken). Na 3x
      // stoppen we i.p.v. dure model-calls te blijven verbranden.
      const sig = JSON.stringify(action);
      if (sig === lastActionSig) {
        repeatCount++;
        if (repeatCount >= 2) {
          const benign = action.kind === "extract" || action.kind === "wait";
          if (benign) {
            // lezen/wachten herhaald -> waarschijnlijk klaar met kijken. Toon WEL de
            // verzamelde informatie, anders verliest de gebruiker het antwoord.
            const answer = composeAnswer("Taak afgerond.", findings);
            this.hand.update({ status: "klaar", step, message: answer, action });
            return { status: "klaar", summary: answer, steps: step };
          }
          // klik/typ/select herhaald → Claude Code om herstelplan vragen
          const r = await this.escalateOrStop({
            signal: makeSignal("repeat", "Vastgelopen: model herhaalt exact dezelfde stap"),
            step, url: snapshot.url, lastAction: action, goal, history,
            reset: () => { repeatCount = 0; lastActionSig = ""; },
          });
          if (r === "recovered") continue; // geen act() uitgevoerd → continue is veilig
          this.hand.update({
            status: "gestopt",
            step,
            message: "Vastgelopen: model herhaalt dezelfde stap, alle herstelplannen uitgeput.",
            action,
          });
          return { status: "gestopt", steps: step };
        }
      } else {
        repeatCount = 0;
      }

      // Alternerende 2-cyclus detectie: A→B→A→B → na 3 keer stuck-signaal geven.
      if (sig !== lastActionSig) {
        if (sig === prevSig && lastActionSig !== "") {
          alternateCount++;
          if (alternateCount >= 3) {
            const r = await this.escalateOrStop({
              signal: makeSignal("state-loop", `Vastgelopen in 2-cyclus: ${lastActionSig} ↔ ${sig} (${alternateCount}× herhaald)`),
              step, url: snapshot.url, lastAction: action, goal, history,
              reset: () => { alternateCount = 0; prevSig = ""; },
            });
            if (r === "recovered") continue;
            this.hand.update({
              status: "gestopt",
              step,
              message: "Vastgelopen in herhalende klik-cyclus. Probeer de taak anders te formuleren.",
              action,
            });
            return { status: "gestopt", steps: step };
          }
        } else {
          alternateCount = 0;
        }
      }
      prevSig = lastActionSig;
      lastActionSig = sig;

      const node = refNode(snapshot, action);

      // Voor click-at (vision-fallback, geen ref) vraagt buildGateContext() de Hand eerst
      // (resolveOnly, geen klik) welk element ECHT op die positie staat, zodat de poort
      // hieronder dezelfde write-role/CONFIRM_WORDS/DENY_WORDS-check kan toepassen als bij
      // een gewone klik. Zie de uitgebreide toelichting bij buildGateContext() hierboven.
      const { ctx, resolveFailure } = await buildGateContext(this.hand, action, snapshot.url, node);
      if (resolveFailure) {
        this.hand.update({ status: "bezig", step, message: `Klik-positie mislukt: ${resolveFailure.detail ?? "geen element gevonden"}`, action });
        history.push({ action, ok: false, detail: resolveFailure.detail ?? "kon doelwit op deze positie niet vaststellen" });
        continue;
      }

      const denied = checkDenied(action, ctx);
      if (denied.denied) {
        this.hand.update({ status: "geweigerd", step, message: `Geweigerd: ${denied.reason}`, action });
        history.push({ action, ok: false, detail: `geweigerd door de poort (${denied.reason})` });
        continue;
      }

      // needsConfirm() wordt ALTIJD afgedwongen, ongeacht autonomy. "auto" mag de
      // mens-bevestiging nooit overslaan voor een schrijvende actie (write-role klik,
      // cross-origin navigatie, upload, select, of type/paste met CONFIRM_WORDS/submit):
      // de MCP-tool-interface die Claude Code zelf gebruikt (yad_run_goal) dwingt altijd
      // autonomy="auto" af en kan geen andere waarde meegeven (companion-client.ts), dus
      // "auto" was in de praktijk de ENIGE modus die de MCP-laag ooit gebruikt. Een pagina
      // met verborgen/geïnjecteerde tekst kon daardoor elke niet-betaal muterende actie
      // laten uitvoeren zonder dat een mens het ooit zag (adversariële review 2026-09-13).
      // De harde deny-lijst hierboven (checkDenied + pathIsDenied) blijft daarnaast áltijd
      // actief, in elke modus. "auto" blijft alleen vrijstelling geven voor acties waar
      // needsConfirm() sowieso al false teruggeeft (extract/wait/finish, same-origin
      // navigatie, niet-muterende klik/type zonder CONFIRM_WORDS) — dat gedrag is ongewijzigd.
      if (needsConfirm(action, ctx)) {
        // Bij click-at heeft de mens anders geen enkel houvast ("Klik op positie (43%,
        // 21%)" zegt niets) — laat de zojuist opgehaalde rol/naam expliciet zien zodat de
        // bevestiging een geïnformeerde keuze is, geen blinde formaliteit.
        const targetHint =
          action.kind === "click-at" && (ctx.role || ctx.targetName)
            ? ` (doelwit: ${ctx.role ?? "onbekende rol"}${ctx.targetName ? ` "${ctx.targetName.slice(0, 60)}"` : ""})`
            : "";
        let approved = false;
        try {
          approved = await this.hand.requestConfirm(action, `Deze actie wijzigt iets: ${describe(action)}${targetHint}`);
        } catch {
          approved = false;
        }
        if (!approved) {
          this.hand.update({ status: "gestopt", step, message: "Afgebroken bij de bevestiging.", action });
          return { status: "gestopt", steps: step };
        }
      }

      await this.sleep(this.humanPause(profile.pacingMs)); // pacing: site-bewust en gejitterd

      // Verrijk de actie met site-profiel metadata (typeDelay, scrollPause) zodat
      // de Hand precies weet hoe mensachtig hij moet handelen op deze site.
      const enriched = enrichAction(action, profile);

      this.hand.update({ status: "bezig", step, message: describe(action), action });
      let result: ActResult;
      try {
        // `wait-for` gaat NIET naar de Hand. Er valt niets uit te voeren in de pagina:
        // we kijken alleen herhaaldelijk of een voorwaarde inmiddels waar is. Dat hoort
        // hier, waar de snapshots al binnenkomen.
        result = action.kind === "wait-for"
          ? await this.waitForCondition(action)
          : await this.hand.act(enriched);
      } catch (e) {
        result = { ok: false, detail: (e as Error).message };
      }
      // Objectief bewijs: URL + actie + resultaat. Feiten, geen evaluatie.
      // De buitenste Planner leest dit bestand om te beoordelen wat er is gebeurd.
      if (this.stepLogger) {
        this.stepLogger.append({
          run: this.runId,
          step,
          url: snapshot.url,
          action: enriched,
          ok: result.ok,
          extracted: result.extracted,
          detail: result.detail,
          ts: Date.now(),
        });
      }

      // Effect-nul: onthoud de pre-actie fingerprint voor muterende acties, zodat de
      // volgende iteratie kan checken of er iets veranderde. navigate telt niet mee
      // (verandert per definitie de URL); extract/wait zijn niet-muterend.
      const isMutating = action.kind === "click" || action.kind === "click-at" || action.kind === "type" || action.kind === "paste" || action.kind === "select" || action.kind === "hover" || action.kind === "keyboard" || action.kind === "upload";
      if (result.ok && isMutating) {
        pendingEffectCheck = { pre: orderSensitiveFingerprint(snapshot), step };
        // Selector-geheugen: sla succesvol gebruikt element op voor toekomstige hints.
        // Alleen click/type/select/paste — hover/keyboard/upload zijn minder herkenbaar.
        if (
          this.selectorStore &&
          node &&
          node.name &&
          (action.kind === "click" || action.kind === "type" || action.kind === "select" || action.kind === "paste")
        ) {
          const hostname = hostnameOf(snapshot.url);
          if (hostname) {
            this.selectorStore.record(hostname, pathOf(snapshot.url), node.role, node.name, action.kind);
          }
        }
      }
      // Onverwachte-navigatie-tracker: sla URL + role op na een geslaagde click op een niet-link.
      // In de volgende iteratie vergelijken we of de URL veranderde ondanks dat de click geen
      // navigatie-element raakte (role !== "link"). Reset bij elke andere actie of na URL-check.
      if (action.kind === "click" && result.ok) {
        const clickedNode = refNode(snapshot, action);
        if (clickedNode?.role && clickedNode.role !== "link") {
          lastNonLinkClickUrl = snapshot.url;
          lastNonLinkClickRole = clickedNode.role;
        } else {
          lastNonLinkClickUrl = "";
          lastNonLinkClickRole = "";
        }
      } else if (action.kind !== "wait" && action.kind !== "scroll") {
        lastNonLinkClickUrl = "";
        lastNonLinkClickRole = "";
      }

      // DOM-refresh na select: combobox-DOM wordt volledig herbouwd na selectie → alle
      // resterende micro-plan-refs zijn stale. Gooi het plan weg zodat het model een verse
      // snapshot krijgt. Voorkomt de "ref e2 is geen keuzelijst"-bug na een geslaagde select.
      if (result.ok && action.kind === "select" && this.currentPlan.length > 0) {
        this.log(`plan gewist na select (${this.currentPlan.length} resterende stap(pen) vervallen door DOM-refresh)`);
        this.currentPlan = [];
      }

      // Derde vastloop-detector: als 3 opeenvolgende acties mislukken, is er
      // waarschijnlijk DOM-drift, een modal die alles blokkeert, of een captcha.
      // Reset bij expliciete doelgerichte actie of URL-change.
      if (result.ok) {
        consecutiveActFailures = 0;
        // Progress grounding: alleen acties die duidelijk doelgericht zijn tellen als voortgang.
        // navigate + select = expliciete keuze; type = formulier-invoer.
        // Generieke clicks tellen NIET — een klik op het verkeerde element retourneert ook ok=true
        // maar brengt de agent niet dichter bij het doel (semantische afdwaling).
        // Judge-"match" (lijn 653) en URL-change (lijn 312) zijn de andere reset-triggers.
        if (action.kind === "navigate" || action.kind === "select" || action.kind === "type" || action.kind === "paste" || action.kind === "keyboard") {
          llmCallsSinceProgress = 0;
        }
      } else {
        consecutiveActFailures++;
        if (consecutiveActFailures >= 3 && action.kind !== "navigate" && action.kind !== "wait") {
          const r = await this.escalateOrStop({
            signal: makeSignal("consecutive-act-failures", "Browser weigert acties (DOM-drift/modal/captcha?)"),
            step, url: snapshot.url, lastAction: action, goal, history,
            reset: () => { consecutiveActFailures = 0; },
          });
          if (r === "give-up") {
            this.hand.update({ status: "gestopt", step, message: "Run gestopt — browser weigerde 3 acties, geen herstelplan." });
            return { status: "gestopt", steps: step };
          }
        }
      }

      // Judge: beoordeel of de uitkomst overeenkwam met de verwachting.
      // Niet aanroepen voor navigate/wait — die zijn mechanisch (succes = URL bereikt).
      // Alleen bij click/type/select/extract: die hebben semantische uitkomsten.
      const judgeApplies = action.kind !== "navigate" && action.kind !== "wait";
      let judgeDetail = "";
      if (expectedOutcome && result.ok && judgeApplies) {
        const jResult = await callJudge(this.judgeRouter, {
          expected: expectedOutcome,
          url: snapshot.url,
          extracted: result.extracted,
          hadEffect: result.ok,
        });
        this.log(`Judge: ${jResult.verdict} — ${jResult.evidence.slice(0, 80)}`);

        if (jResult.verdict === "unknown") {
          consecutiveUnknowns++;
          judgeDetail = ` [judge:unknown]`;
          if (consecutiveUnknowns >= 3) {
            const r = await this.escalateOrStop({
              signal: makeSignal("consecutive-unknowns", `Aanhoudende onzekerheid: judge kon ${consecutiveUnknowns} stappen niet beoordelen`),
              step, url: snapshot.url, lastAction: action, goal, history,
              reset: () => { consecutiveUnknowns = 0; },
            });
            // Geen continue bij herstel: history.push() hieronder mag nog, actie is al uitgevoerd.
            if (r === "give-up") {
              if (this.onStuck) {
                // onStuck-kanaal bestaat maar gaf geen plan (timeout of plafond) → stop.
                this.hand.update({ status: "gestopt", step, message: "Run gestopt — geen herstelplan (timeout of plafond bereikt)." });
                return { status: "gestopt", steps: step };
              }
              // Geen onStuck-kanaal → terugval op menselijke bevestiging (oude flow).
              const dummy: Action = { kind: "wait", ms: 0 };
              const approved = await this.hand.requestConfirm(
                dummy,
                `Onzeker over voortgang na ${consecutiveUnknowns} opeenvolgende stappen. Doorgaan?`,
              );
              if (!approved) {
                this.hand.update({ status: "gestopt", step, message: "Run gestopt — te veel onzekere stappen achter elkaar." });
                return { status: "gestopt", steps: step };
              }
              consecutiveUnknowns = 0;
            }
          }
        } else {
          consecutiveUnknowns = 0;
          judgeDetail = ` [judge:${jResult.verdict}]`;
          if (jResult.verdict === "match") {
            // Judge bevestigt voortgang → reset no-progress teller
            llmCallsSinceProgress = 0;
          } else if (jResult.verdict === "mismatch") {
            // Mismatch → rest van het plan weggooien zodat het model opnieuw plant.
            this.currentPlan = [];
          }
        }
      }

      history.push({
        action,
        ok: result.ok,
        detail: (
          (result.detail ?? (result.extracted ? result.extracted.slice(0, 200) : "")) + judgeDetail
        ).trim() || undefined,
      });
      // click-at is een vision-gegronde eenmalige beslissing (pixel-positie op DEZE
      // pagina-staat) — niet cachen voor blinde replay, een andere dag kan de layout
      // verschoven zijn en dan klikt de replay op iets anders dan bedoeld.
      if (action.kind === "click-at") cleanRun = false;
      // Actie mislukt → resterende plan-stappen weggooien.
      // Volgende iteratie start met een leeg plan → dwingt nieuwe LLM-aanroep af.
      // Dit is het "stops earlier" mechanisme: geen blinde vervolgstap na een fout.
      if (!result.ok) {
        this.currentPlan = [];
      }
      // Bewaar de VOLLEDIGE geëxtraheerde inhoud (niet de 200-tekens-history-versie)
      // voor het eind-antwoord aan de gebruiker.
      if (result.extracted && result.extracted.trim()) {
        const label = action.kind === "extract" ? action.what : action.kind;
        findings.push(`${label}: ${result.extracted.trim().slice(0, 1500)}`);
      }

      // Extract-lus bewaker (code-niveau): forceer finish na 2+ opeenvolgende
      // extracts op dezelfde URL. Prompt-regel wordt niet altijd nageleefd door het model.
      if (action.kind === "extract") {
        if (snapshot.url === lastExtractUrl) {
          consecutiveSameUrlExtracts++;
          if (consecutiveSameUrlExtracts >= 2) {
            this.log(`extract-lus: ${consecutiveSameUrlExtracts} opeenvolgende extracts op ${snapshot.url} — run gestopt`);
            // "gestopt", niet "klaar". Een run die alleen las heeft de gevraagde actie
            // niet uitgevoerd, en mag dat niet als succes melden. Deze bewaker zat vóór
            // de DONE-poort (regel 990) en omzeilde die dus volledig.
            //
            // Live bewijs 2026-09-07: de runs 9guchw9l en 7vigymjv moesten een
            // YouTube-reactie plaatsen, deden uitsluitend navigate/scroll/extract, en
            // werden hier als "klaar" geboekt. Er is nooit iets geplaatst; de YouTube
            // API bevestigde dat onafhankelijk. "gestopt" mapt in session.ts:58 naar
            // outcome "stuck", precies wat dit is.
            const answer = composeAnswer(
              "Gestopt: alleen de pagina gelezen, de gevraagde actie is niet uitgevoerd.",
              findings,
            );
            this.hand.update({ status: "gestopt", step, message: answer, action });
            return { status: "gestopt", summary: answer, steps: step };
          }
        } else {
          consecutiveSameUrlExtracts = 1;
          lastExtractUrl = snapshot.url;
        }
      } else if (
        action.kind === "click" || action.kind === "click-at" || action.kind === "navigate" ||
        action.kind === "type" || action.kind === "select" || action.kind === "upload"
      ) {
        consecutiveSameUrlExtracts = 0;
        lastExtractUrl = "";
      }

      this.log(`stap ${step}: ${JSON.stringify(action)} -> ${result.ok ? "ok" : "fout"}`);
    }

    // "gestopt", niet "klaar": de samenvatting zei zelf al "Gestopt na N stappen",
    // terwijl de status succes meldde. Het stappenplafond raken betekent dat het doel
    // niet is afgerond, dus dit hoort outcome "stuck" te geven (session.ts:58), niet
    // "success". Ook dit pad omzeilde de DONE-poort volledig.
    const answer = composeAnswer(`Gestopt na ${maxSteps} stappen, doel niet afgerond.`, findings);
    this.hand.update({ status: "gestopt", message: answer });
    return { status: "gestopt", summary: answer, steps: maxSteps };
  }

  /**
   * Vraagt het model om de volgende actie, met terugval bij een tijdelijke
   * overbelasting van de gratis providers (429/rate-limit). De router schakelt al
   * door alle providers; faalt de HELE pool tijdelijk, dan wachten we hier even en
   * proberen we de stap opnieuw — i.p.v. de run hard te laten sterven. Per-minuut
   * rate-limits hebben seconden nodig, dus de backoff is bewust ruim.
   */
  private async chatWithRetry(
    goal: string,
    snapshot: Snapshot,
    history: HistoryItem[],
    step: number,
    attachments?: Attachment[],
    failedHint?: string,
    substateHint?: string,
    failedHintScreenshot?: string,
    selectorHint?: string,
  ): Promise<string> {
    const backoffs = [0, 4000, 9000]; // eerste poging direct, dan oplopend wachten
    let lastErr: unknown;
    for (const wait of backoffs) {
      if (wait > 0) {
        this.hand.update({
          status: "bezig",
          step,
          message: `De gratis modellen zijn even druk; opnieuw over ${Math.round(wait / 1000)}s…`,
        });
        await this.sleep(wait);
        if (this.isAborted()) throw new Error("afgebroken tijdens wachten op een vrij model");
      }
      // De allereerste poging (wait === 0) sloeg deze check voorheen helemaal over, dus
      // een Stop-klik vlak voor de allereerste modelaanroep van een stap werd genegeerd
      // tot de aanroep zelf klaar was.
      if (this.isAborted()) throw new Error("afgebroken vlak voor een modelaanroep");
      try {
        const res = await this.router.chat({
          messages: buildMessages(goal, snapshot, history, {
            language: this.language,
            attachments,
            failedHint,
            substateHint,
            failedHintScreenshot,
            selectorHint,
          }),
          temperature: 0,
          json: true,
          maxTokens: 400,
        });
        const used = `${res.provider}:${res.model}`;
        if (!this._providersUsed.includes(used)) this._providersUsed.push(used);
        return res.content;
      } catch (e) {
        lastErr = e;
        if (!isTransient(e)) throw e; // auth/ongeldig model: opnieuw proberen heeft geen zin
      }
    }
    throw lastErr;
  }
}

/** Extraheert hostname uit een URL; leeg bij ongeldige URL. */
function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

/** Extraheert pathname uit een URL; leeg bij ongeldige URL. */
function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return ""; }
}

/**
 * Bouwt het eind-antwoord voor de gebruiker. De samenvatting van het model is op
 * gratis modellen vaak mager ("klaar"), dus we plakken de werkelijk geëxtraheerde
 * informatie eronder. Zo krijgt de mens altijd het ANTWOORD te zien, niet alleen
 * de mededeling dat de taak af is.
 */
/** Lege-summary patronen: model zei "Taak afgerond." maar heeft misschien wél data. */
const PLACEHOLDER_SUMMARIES = /^(taak afgerond|klaar|done|task completed|afgerond|completed|finish)\.?$/i;

/** Navigatie-/UI-termen die in ruwe paginatekst voorkomen maar geen antwoord zijn. */
const NAV_NOISE = /^(home|menu|terug|volgende|vorige|inloggen|aanmelden|registreer|privacy|cookie|help|contact|sitemap|taal|language|zoeken?|filters?|sorter|toon\s*meer|load\s*more|page\s*\d|linkedin|facebook|twitter|instagram|whatsapp|jobs|vacatures|alle\s|wachtwoord|email|gebruikersnaam|send|submit|cancel|close|sluiten|ja|nee|ok|bevestig)/i;

/**
 * Converteert ruwe paginatekst-findings naar een leesbare genummerde lijst.
 * Wordt gebruikt als fallback wanneer het model geen goede summary schreef.
 */
function cleanRawFindings(rawFindings: string[]): string {
  // Strip de "label: " prefix die loop.ts toevoegt (bv. "vacatures voor AI specialisten: ...")
  const fullText = rawFindings.map(f => {
    const colonIdx = f.indexOf(": ");
    return colonIdx > 0 && colonIdx < 80 ? f.slice(colonIdx + 2) : f;
  }).join("\n");

  // Split op newlines en pipes, trim, filter
  const lines = fullText.split(/[\n|]/)
    .map(l => l.trim())
    .filter(l => l.length >= 12 && l.length <= 130)
    .filter(l => !NAV_NOISE.test(l))
    .filter(l => !/^https?:\/\//.test(l))   // kale URLs
    .filter(l => !/^\d+$/.test(l));          // alleen cijfers

  if (lines.length === 0) {
    // Noodval: geef eerste 600 tekens van de ruwe tekst
    return rawFindings.join("\n").slice(0, 600);
  }

  // Dedupliceer (case-insensitief)
  const seen = new Set<string>();
  const unique = lines.filter(l => {
    const k = l.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 20);

  return unique.map((l, i) => `${i + 1}. ${l}`).join("\n");
}

function composeAnswer(summary: string, findings: string[]): string {
  const s = (summary ?? "").trim();
  const isEmpty = !s || PLACEHOLDER_SUMMARIES.test(s);

  if (isEmpty && findings.length > 0) {
    // Model gaf lege samenvatting maar er is geëxtraheerde data — clean en geef terug.
    return cleanRawFindings(findings);
  }
  const base = s || "Klaar.";
  if (findings.length === 0) return base;
  // Als de summary al inhoudelijk is (>200 chars), bevat hij waarschijnlijk het antwoord.
  // Dan de ruwe findings NIET toevoegen — dat verdubbelt alleen de ruis.
  if (base.length > 200) return base;
  return `${base}\n\n— Gevonden —\n${cleanRawFindings(findings)}`;
}

/**
 * Verrijkt een actie met site-profiel metadata. De LLM weet niks van typeDelay of
 * scrollPause — die injecteert de loop hier, nadat het profiel van de huidige URL
 * is bepaald. Zo gedraagt de Hand zich op LinkedIn anders dan op een interne tool.
 */
function enrichAction(action: Action, profile: SiteProfile): Action {
  if (action.kind === "type" && profile.typeDelayMs > 0) {
    return {
      kind: "type",
      ref: action.ref,
      text: action.text,
      submit: action.submit,
      typeDelay: profile.typeDelayMs,
    };
  }
  if (action.kind === "click" && profile.scrollPauseMs > 0) {
    return { kind: "click", ref: action.ref, scrollPause: profile.scrollPauseMs };
  }
  return action;
}

/** Tijdelijke fout (rate-limit/netwerk/timeout) -> opnieuw proberen kan helpen. */
function isTransient(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return (
    m.includes("429") ||
    m.includes("rate") ||
    m.includes("quota") ||
    m.includes("timeout") ||
    m.includes("time-out") ||
    m.includes("netwerk") ||
    m.includes("fetch failed") ||
    m.includes("alle providers")
  );
}

/** Mensvriendelijke foutmelding voor de sidepanel-log (geen rauwe stacktrace). */
function friendlyLlmError(e: unknown): string {
  if (isTransient(e)) {
    return (
      "De gratis AI-modellen zitten even op hun limiet (rate-limit). Wacht een minuutje en " +
      "probeer opnieuw, of zet een betaalde sleutel (YAD_PAID_API_KEY) voor onbeperkt gebruik."
    );
  }
  return `Het model gaf geen antwoord: ${(e as Error)?.message ?? String(e)}`;
}
