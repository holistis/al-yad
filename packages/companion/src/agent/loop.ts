import type { Action, ActResult, RunStatus, Snapshot } from "@yad/shared";
import type { ChatRequest } from "../engine/types.js";
import { buildMessages, type HistoryItem } from "./prompt.js";
import { parseAction } from "./parse.js";
import { checkDenied, needsConfirm, pathIsDenied, type GateContext } from "../gate/guardrails.js";
import type { SnapshotNode } from "@yad/shared";

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
  pacingMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (m: string) => void;
  /** wordt elke stap gecheckt; true = run netjes afbreken (bv. tab gesloten) */
  isAborted?: () => boolean;
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
  private readonly log: (m: string) => void;

  constructor(
    private readonly router: ChatLike,
    private readonly hand: HandBridge,
    opts: LoopOptions = {},
  ) {
    this.maxSteps = opts.maxSteps ?? 15;
    this.pacingMs = opts.pacingMs ?? 1000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = opts.log ?? (() => {});
    this.isAborted = opts.isAborted ?? (() => false);
  }

  private readonly isAborted: () => boolean;

  async run(goal: string, maxStepsOverride?: number): Promise<RunOutcome> {
    const maxSteps = Math.min(maxStepsOverride ?? this.maxSteps, 40);
    const history: HistoryItem[] = [];
    this.hand.update({ status: "plannen", message: `Doel: ${goal}` });

    let parseFails = 0;
    let lastActionSig = "";
    let repeatCount = 0;

    for (let step = 1; step <= maxSteps; step++) {
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
        content = await this.chatWithRetry(goal, snapshot, history, step);
      } catch (e) {
        this.hand.update({ status: "fout", step, message: friendlyLlmError(e) });
        return { status: "fout", steps: step - 1 };
      }

      const parsed = parseAction(content);
      if (!parsed.ok) {
        parseFails++;
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
        this.hand.update({ status: "klaar", step, message: action.summary, action });
        return { status: "klaar", summary: action.summary, steps: step };
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
            // lezen/wachten herhaald -> waarschijnlijk klaar met kijken
            this.hand.update({
              status: "klaar",
              step,
              message: "Taak afgerond (het model herhaalde dezelfde leesstap).",
              action,
            });
            return { status: "klaar", summary: "afgerond na herhaalde leesstap", steps: step };
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

      if (needsConfirm(action, ctx)) {
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

      await this.sleep(this.pacingMs); // pacing: rustig en mensachtig

      this.hand.update({ status: "bezig", step, message: describe(action), action });
      let result: ActResult;
      try {
        result = await this.hand.act(action);
      } catch (e) {
        result = { ok: false, detail: (e as Error).message };
      }
      history.push({
        action,
        ok: result.ok,
        detail: result.detail ?? (result.extracted ? result.extracted.slice(0, 200) : undefined),
      });
      this.log(`stap ${step}: ${JSON.stringify(action)} -> ${result.ok ? "ok" : "fout"}`);
    }

    this.hand.update({ status: "klaar", message: `Gestopt na ${maxSteps} stappen.` });
    return { status: "klaar", steps: maxSteps };
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
          messages: buildMessages(goal, snapshot, history),
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
