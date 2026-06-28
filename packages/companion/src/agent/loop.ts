import type { Action, ActResult, RunStatus, Snapshot } from "@yad/shared";
import type { ChatRequest } from "../engine/types.js";
import { buildMessages, type HistoryItem } from "./prompt.js";
import { parseAction } from "./parse.js";
import { checkDenied, needsConfirm, type GateContext } from "../gate/guardrails.js";

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
}

export interface RunOutcome {
  status: RunStatus;
  summary?: string;
  steps: number;
}

function refName(snapshot: Snapshot, action: Action): string | undefined {
  const ref = (action as { ref?: string }).ref;
  if (!ref) return undefined;
  return snapshot.nodes.find((n) => n.ref === ref)?.name;
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
  }

  async run(goal: string, maxStepsOverride?: number): Promise<RunOutcome> {
    const maxSteps = Math.min(maxStepsOverride ?? this.maxSteps, 40);
    const history: HistoryItem[] = [];
    this.hand.update({ status: "plannen", message: `Doel: ${goal}` });

    let parseFails = 0;

    for (let step = 1; step <= maxSteps; step++) {
      let snapshot: Snapshot;
      try {
        snapshot = await this.hand.requestSnapshot();
      } catch (e) {
        this.hand.update({ status: "fout", step, message: `Kon de pagina niet lezen: ${(e as Error).message}` });
        return { status: "fout", steps: step - 1 };
      }

      let content: string;
      try {
        const res = await this.router.chat({
          messages: buildMessages(goal, snapshot, history),
          temperature: 0,
          json: true,
          maxTokens: 400,
        });
        content = res.content;
      } catch (e) {
        this.hand.update({ status: "fout", step, message: `Het model gaf geen antwoord: ${(e as Error).message}` });
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

      const ctx: GateContext = { currentUrl: snapshot.url, targetName: refName(snapshot, action) };

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
}
