import type { Action, ActResult, RunStatus, Snapshot, Attachment } from "@yad/shared";
import type { ChatRequest } from "../engine/types.js";
import { buildMessages, type HistoryItem } from "./prompt.js";
import { parseAction } from "./parse.js";
import { checkDenied, needsConfirm, pathIsDenied, type GateContext } from "../gate/guardrails.js";
import type { SnapshotNode } from "@yad/shared";
import { getSiteProfile, getProfileByTier, type SiteProfile, type SiteTier } from "../engine/site-profile.js";
import { CacheStore, makeCacheKey, urlToPattern } from "../memory/cache-store.js";
import { replayCache } from "../memory/replay.js";

export interface ChatLike {
  chat(req: ChatRequest): Promise<{ content: string; provider: string }>;
}

export interface HandBridge {
  requestSnapshot(): Promise<Snapshot>;
  act(action: Action): Promise<ActResult>;
  requestConfirm(action: Action, reason: string): Promise<boolean>;
  update(u: { status: RunStatus; step?: number; message: string; action?: Action }): void;
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
  }

  private readonly isAborted: () => boolean;

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

    let parseFails = 0;
    let cleanRun = true; // false zodra er een parse-fout is geweest; vuile runs worden niet gecached.
    let lastActionSig = "";
    let repeatCount = 0;
    let lastTier = "";
    // Geëxtraheerde informatie tijdens de run; dit wordt het eind-antwoord aan de
    // gebruiker. Zonder dit ziet de mens alleen "klaar" en niet wat er gevonden is.
    const findings: string[] = [];

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

      let content: string;
      try {
        content = await this.chatWithRetry(goal, snapshot, history, step, attachments);
      } catch (e) {
        this.hand.update({ status: "fout", step, message: friendlyLlmError(e) });
        return { status: "fout", steps: step - 1 };
      }

      const parsed = parseAction(content);
      if (!parsed.ok) {
        parseFails++;
        cleanRun = false;
        this.log(`parse-fout: ${parsed.error}`);
        history.push({ action: { kind: "wait", ms: 0 }, ok: false, detail: `onleesbaar modelantwoord (${parsed.error})` });
        if (parseFails >= 3) {
          this.hand.update({ status: "fout", step, message: "Model bleef onleesbare antwoorden geven." });
          return { status: "fout", steps: step };
        }
        continue;
      }
      parseFails = 0;
      const action = parsed.action;

      if (action.kind === "finish") {
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
          // klik/typ/select herhaald -> EERLIJK melden dat het vastliep (niet 'klaar' faken)
          this.hand.update({
            status: "gestopt",
            step,
            message:
              "Vastgelopen: het model bleef dezelfde knop/stap herhalen. " +
              "Deze pagina is te complex voor het gratis model — probeer een concretere opdracht, " +
              "een eenvoudigere site, of zet een betaalde sleutel.",
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
      history.push({
        action,
        ok: result.ok,
        detail: result.detail ?? (result.extracted ? result.extracted.slice(0, 200) : undefined),
      });
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
