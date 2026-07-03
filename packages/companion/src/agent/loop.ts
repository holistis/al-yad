import type { Action, ActResult, RunStatus, Snapshot, Attachment } from "@yad/shared";
import type { ChatRequest } from "../engine/types.js";
import { buildMessages, type HistoryItem } from "./prompt.js";
import { parseMicroPlan, type PlannedStep } from "./parse.js";
import { callJudge } from "../judge/judge.js";
import { evaluatePredicates } from "./predicate.js";
import { checkDenied, needsConfirm, pathIsDenied, type GateContext } from "../gate/guardrails.js";
import type { SnapshotNode } from "@yad/shared";
import { getSiteProfile, getProfileByTier, type SiteProfile, type SiteTier } from "../engine/site-profile.js";
import { CacheStore, makeCacheKey, urlToPattern } from "../memory/cache-store.js";
import { replayCache } from "../memory/replay.js";
import { makeSignal, type Signal } from "./arbiter.js";

/** Plafond op het aantal keren dat één run Claude Code om een herstelplan mag vragen.
 *  Voorkomt een meta-lus: YAD vraagt hulp → plan faalt → vraagt opnieuw → etc. */
const MAX_RECOVERY_ATTEMPTS = 3;

export interface ChatLike {
  chat(req: ChatRequest): Promise<{ content: string; provider: string }>;
}

export interface HandBridge {
  requestSnapshot(): Promise<Snapshot>;
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
    | "silent-no-effect";        // muterende actie slaagt (ok=true) maar verandert de pagina niet
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
}

function refNode(snapshot: Snapshot, action: Action): SnapshotNode | undefined {
  const ref = (action as { ref?: string }).ref;
  if (!ref) return undefined;
  return snapshot.nodes.find((n) => n.ref === ref);
}

function describe(action: Action): string {
  switch (action.kind) {
    case "navigate":
      return `Ga naar ${action.url}`;
    case "click":
      return `Klik op ${action.ref}`;
    case "type":
      return `Typ in ${action.ref}${action.submit ? " en verstuur" : ""}`;
    case "select":
      return `Kies ${action.value} in ${action.ref}`;
    case "extract":
      return `Lees: ${action.what}`;
    case "wait":
      return `Wacht ${action.ms}ms`;
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
  /** Hoeveel keer deze run al om een herstelplan is gevraagd (plafond: MAX_RECOVERY_ATTEMPTS). */
  private recoveryAttempts = 0;

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
  }

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
    this.hand.update({
      status: "hulp-nodig",
      step,
      message: `${signal.evidence} — Claude Code om herstelplan gevraagd.`,
      action: lastAction,
    });
    const hint = await this.escalate(
      { why: signal.id as StuckReason["why"], runId: this.runId, goal, url, lastAction, history },
      this.recoveryAttempts,
      MAX_RECOVERY_ATTEMPTS,
    );
    if (hint) {
      this.recoveryAttempts++;
      this.failedHint = hint;
      reset();
      this.currentPlan = [];
      this.hand.update({
        status: "bezig",
        step,
        message: `Herstelplan ontvangen (escalatie ${this.recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS}) — andere aanpak...`,
      });
      return "recovered";
    }
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

  async run(goal: string, maxStepsOverride?: number, attachments?: Attachment[]): Promise<RunOutcome> {
    const maxSteps = Math.min(maxStepsOverride ?? this.maxSteps, 40);
    const history: HistoryItem[] = [];
    this.hand.update({ status: "plannen", message: `Doel: ${goal}` });

    this.currentPlan = []; // reset per run — vorige plan-rest nooit meenemen
    this.failedHint = undefined; // reset per run
    this.recoveryAttempts = 0; // reset per run — escalatie-plafond geldt per run
    let parseFails = 0;
    let cleanRun = true; // false zodra er een parse-fout is geweest; vuile runs worden niet gecached.
    let lastActionSig = "";
    let repeatCount = 0;
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
    // Effect-nul-detector (lost stil falen op — Run 2): een muterende actie (click/type/select)
    // die ok=true geeft maar de pagina niet verandert, is een verdachte no-op. We onthouden de
    // volgorde-gevoelige fingerprint VÓÓR de actie en vergelijken hem met de snapshot van de
    // VOLGENDE iteratie. Identiek = geen waarneembaar effect. Anders dan de andere tellers reset
    // deze NIET op het mechanische actie-type, maar alleen op een ECHT waargenomen verandering.
    let stepsSinceRealEffect = 0;
    let pendingEffectCheck: { pre: string; step: number } | null = null;
    const MAX_NO_EFFECT = 3;
    // DONE-predicaat bewaker: telt hoeveel keer een finish-poging is geblokkeerd.
    // Na 2 weigeringen stopt de loop — voorkomt oneindige weiger-loop.
    let finishRejections = 0;
    const MAX_FINISH_REJECTIONS = 2;

    // Startpagina ophalen voor cache-sleutel en optionele replay.
    let startingUrl = "";
    let loopStartStep = 1;
    try {
      const initSnap = await this.hand.requestSnapshot();
      startingUrl = initSnap.url;
    } catch { /* snapshot mislukt → gewoon zonder cache */ }

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
          (a) => this.hand.act(a),
          (msg, step, action) => this.hand.update({ status: "bezig", step, message: msg, action }),
        );
        this.cacheStore.hit(cacheKey);
        if (replay.status === "complete") {
          const msg = `Taak voltooid via cache — ${cached.actions.length} stappen, 0 LLM-calls.`;
          this.hand.update({ status: "klaar", message: msg });
          return { status: "klaar", summary: msg, steps: cached.actions.length };
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
      }
      // Registreer het startpad eenmalig (eerste iteratie)
      if (!lastKnownUrl && uniquePathsSeen.size === 0) {
        try { uniquePathsSeen.add(new URL(snapshot.url).pathname); } catch { /* skip */ }
      }
      lastKnownUrl = snapshot.url;

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
      const fingerprint = snapshotFingerprint(snapshot);
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
      if (step > 1 && isLoginPage(snapshot.url)) {
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
        // Na 3 opeenvolgende LLM-aanroepen op hetzelfde URL-pad vraagt de Judge of
        // de agent nog richting het doel gaat. Goedkoop: maxTokens=80, temperature=0,
        // alleen bij "mismatch" (niet bij "unknown") → weinig noise-risico.
        if (snapshot.url === lastLlmCallUrl) {
          consecutiveSameUrlLlmCalls++;
        } else {
          consecutiveSameUrlLlmCalls = 0;
          lastLlmCallUrl = snapshot.url;
        }
        if (consecutiveSameUrlLlmCalls >= 3) {
          const recentEvidence = history.slice(-4).map((h) => h.detail).filter(Boolean).join(" ↦ ");
          const driftCheck = await callJudge(this.router, {
            expected: `The agent is making measurable forward progress toward: "${goal.slice(0, 120)}"`,
            url: snapshot.url,
            extracted: recentEvidence || undefined,
            hadEffect: history.slice(-4).some((h) => h.ok),
          });
          this.log(`goal-drift check (${consecutiveSameUrlLlmCalls} calls op ${snapshot.url}): ${driftCheck.verdict} — ${driftCheck.evidence.slice(0, 80)}`);
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
        try {
          content = await this.chatWithRetry(goal, snapshot, history, step, attachments, this.failedHint);
        } catch (e) {
          this.hand.update({ status: "fout", step, message: friendlyLlmError(e) });
          return { status: "fout", steps: step - 1 };
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
        parseFails = 0;
        this.currentPlan = [...planResult.plan.steps];
        this.log(`microPlan (${this.currentPlan.length} stap${this.currentPlan.length !== 1 ? "pen" : ""}): ${planResult.plan.rationale.slice(0, 80)}`);
      }

      const planned = this.currentPlan.shift();
      if (!planned) continue; // defensief — zou nooit mogen
      const action = planned.action;
      const expectedOutcome = planned.expected;

      if (action.kind === "finish") {
        // DONE-predicaat check (Stap 4): weiger de finish als de snapshot het doel
        // niet objectief bevestigt. Voorkomt vals "klaar" (Run 1: model riep finish
        // maar de sortering/checkout was nog niet voltooid).
        const donePreds = planned.done ?? [];
        // Observability: log het finish-moment zodat de step-log laat zien of het model
        // DONE-predicaten meestuurde. Zonder dit was finish onzichtbaar in de log.
        if (this.stepLogger) {
          this.stepLogger.append({
            run: this.runId, step, url: snapshot.url,
            action: { kind: "_finish", donePredicates: donePreds.length },
            ok: true, detail: `finish gepland — ${donePreds.length} DONE-predicaat(en)`,
            ts: Date.now(),
          });
        }
        if (donePreds.length > 0) {
          const doneResult = evaluatePredicates(donePreds, snapshot);
          // Observability: log DONE-check verdict (match/mismatch) inclusief de predicaten.
          if (this.stepLogger) {
            this.stepLogger.append({
              run: this.runId, step, url: snapshot.url,
              action: { kind: "_done-check", verdict: doneResult.verdict, matched: doneResult.matched, total: doneResult.total },
              ok: doneResult.verdict === "match",
              detail: `DONE ${doneResult.verdict} (${doneResult.matched}/${doneResult.total}): ${donePreds.map((p) => JSON.stringify(p)).join(", ")}`,
              ts: Date.now(),
            });
          }
          if (doneResult.verdict === "mismatch") {
            finishRejections++;
            const evidence = `DONE-predicaten niet gehaald (${doneResult.matched}/${doneResult.total}), URL: ${snapshot.url}`;
            this.log(`finish geweigerd #${finishRejections}: ${evidence}`);
            if (finishRejections <= MAX_FINISH_REJECTIONS) {
              // Geef het model de exacte falende predicaten mee zodat het weet
              // welke concrete stap nog ontbreekt (bv. "navigeer naar ?sort=hilo").
              const failedPreds = donePreds
                .map((p, i) => `[${i + 1}] ${JSON.stringify(p)}`)
                .join(", ");
              this.failedHint = `Je riep finish aan maar de pagina bevestigt het doel NIET. ${evidence}. Niet-gehaalde DONE-predicaten: ${failedPreds}. Voer de ontbrekende browser-stappen uit zodat de pagina aan deze predicaten voldoet. Roep daarna opnieuw finish aan MET hetzelfde done-array (laat die niet weg — anders wordt de verificatie overgeslagen).`;
              this.currentPlan = [];
              this.hand.update({ status: "bezig", step, message: `Finish geweigerd — ${evidence}` });
              continue;
            }
            // Plafond bereikt: stoppen om oneindige weiger-lus te voorkomen.
            this.hand.update({ status: "fout", step, message: `Finish ${finishRejections}x geweigerd — ${evidence}` });
            return { status: "fout", steps: step };
          }
          this.log(`finish geaccepteerd: DONE ${doneResult.verdict} (${doneResult.matched}/${doneResult.total})`);
        }

        const answer = composeAnswer(action.summary, findings);
        this.hand.update({ status: "klaar", step, message: answer, action });
        // Cache schrijven: alleen bij schone runs met echte stappen (geen parse-fouten).
        if (this.cacheStore && startingUrl && cleanRun && history.length > 0) {
          const cacheKey = makeCacheKey(goal, startingUrl);
          const existing = this.cacheStore.get(cacheKey);
          this.cacheStore.set({
            key: cacheKey,
            goalPreview: goal.slice(0, 120),
            urlPattern: urlToPattern(startingUrl),
            actions: history.map((h) => h.action),
            savedAt: Date.now(),
            totalRuns: (existing?.totalRuns ?? 0) + 1,
          });
          this.log(`cache opgeslagen: ${history.length} stappen voor "${goal.slice(0, 40)}"`);
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
      lastActionSig = sig;

      const node = refNode(snapshot, action);
      const ctx: GateContext = {
        currentUrl: snapshot.url,
        targetName: node?.name,
        role: node?.role,
      };

      const denied = checkDenied(action, ctx);
      if (denied.denied) {
        this.hand.update({ status: "geweigerd", step, message: `Geweigerd: ${denied.reason}`, action });
        history.push({ action, ok: false, detail: `geweigerd door de poort (${denied.reason})` });
        continue;
      }

      // In "auto" (volledig zelfstandig) slaan we de mens-bevestiging over. De harde
      // deny-lijst hierboven (checkDenied + pathIsDenied) blijft áltijd actief — die
      // is niet te omzeilen, ook niet in auto-modus.
      if (this.autonomy !== "auto" && needsConfirm(action, ctx)) {
        let approved = false;
        try {
          approved = await this.hand.requestConfirm(action, `Deze actie wijzigt iets: ${describe(action)}`);
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
        result = await this.hand.act(enriched);
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
      const isMutating = action.kind === "click" || action.kind === "type" || action.kind === "select";
      if (result.ok && isMutating) {
        pendingEffectCheck = { pre: orderSensitiveFingerprint(snapshot), step };
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
        if (action.kind === "navigate" || action.kind === "select" || action.kind === "type") {
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
        const jResult = await callJudge(this.router, {
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
      this.log(`stap ${step}: ${JSON.stringify(action)} -> ${result.ok ? "ok" : "fout"}`);
    }

    const answer = composeAnswer(`Gestopt na ${maxSteps} stappen.`, findings);
    this.hand.update({ status: "klaar", message: answer });
    return { status: "klaar", summary: answer, steps: maxSteps };
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
      try {
        const res = await this.router.chat({
          messages: buildMessages(goal, snapshot, history, {
            language: this.language,
            attachments,
            failedHint,
          }),
          temperature: 0,
          json: true,
          maxTokens: 400,
        });
        return res.content;
      } catch (e) {
        lastErr = e;
        if (!isTransient(e)) throw e; // auth/ongeldig model: opnieuw proberen heeft geen zin
      }
    }
    throw lastErr;
  }
}

/**
 * Bouwt het eind-antwoord voor de gebruiker. De samenvatting van het model is op
 * gratis modellen vaak mager ("klaar"), dus we plakken de werkelijk geëxtraheerde
 * informatie eronder. Zo krijgt de mens altijd het ANTWOORD te zien, niet alleen
 * de mededeling dat de taak af is.
 */
function composeAnswer(summary: string, findings: string[]): string {
  const s = (summary ?? "").trim() || "Klaar.";
  if (findings.length === 0) return s;
  return `${s}\n\n— Gevonden informatie —\n${findings.join("\n\n")}`;
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
