import {
  brainMessage,
  isEnvelope,
  type Action,
  type ActResult,
  type BrainMessage,
  type BrainPayloads,
  type RunStatus,
  type Snapshot,
} from "@yad/shared";
import { AgentLoop, type HandBridge } from "./agent/loop.js";
import { LlmRouter } from "./engine/router.js";
import { createHandshakeHandler, type CompanionInfo } from "./handshake.js";

type RequestType = "REQUEST_SNAPSHOT" | "ACT" | "REQUEST_CONFIRM";

interface Pending {
  resolve: (payload: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Eén sessie tussen Hand en Brein. Routeert binnenkomende berichten:
 * handshake (HELLO/PING), GOAL (start een run) en de antwoorden op onze eigen
 * verzoeken (SNAPSHOT/ACT/CONFIRM) via correlationId. Implementeert tegelijk de
 * HandBridge die de agent-lus gebruikt om de Hand aan te sturen.
 */
export class BrainSession implements HandBridge {
  private readonly pending = new Map<string, Pending>();
  private readonly handshake: (raw: unknown) => void;
  private running = false;
  private aborted = false;

  constructor(
    private readonly send: (m: BrainMessage) => void,
    private readonly router: LlmRouter,
    info: CompanionInfo,
    private readonly log: (m: string) => void = () => {},
  ) {
    this.handshake = createHandshakeHandler(info, send, log);
  }

  handle(raw: unknown): void {
    if (!isEnvelope(raw)) {
      this.handshake(raw);
      return;
    }
    switch (raw.type) {
      case "HELLO":
      case "PING":
        this.handshake(raw);
        return;
      case "GOAL": {
        const p = raw.payload as { goal?: string; maxSteps?: number };
        if (typeof p?.goal === "string") void this.startRun(p.goal, p.maxSteps);
        return;
      }
      case "ABORT_RUN": {
        this.aborted = true;
        return;
      }
      case "SNAPSHOT_RESULT":
      case "ACT_RESULT":
      case "CONFIRM_RESULT": {
        const cid = raw.correlationId;
        const pend = cid ? this.pending.get(cid) : undefined;
        if (cid && pend) {
          clearTimeout(pend.timer);
          this.pending.delete(cid);
          pend.resolve(raw.payload);
        }
        return;
      }
      default:
        return;
    }
  }

  private async startRun(goal: string, maxSteps?: number): Promise<void> {
    if (this.running) {
      this.update({ status: "fout", message: "Er loopt al een taak." });
      return;
    }
    this.running = true;
    this.aborted = false;
    const loop = new AgentLoop({ chat: (req) => this.router.chat(req) }, this, {
      log: this.log,
      isAborted: () => this.aborted,
    });
    try {
      await loop.run(goal, maxSteps);
    } catch (e) {
      this.update({ status: "fout", message: (e as Error).message });
    } finally {
      this.running = false;
    }
  }

  // ---- HandBridge ----

  requestSnapshot(): Promise<Snapshot> {
    return this.request<{ snapshot: Snapshot }>("REQUEST_SNAPSHOT", {}).then((p) => p.snapshot);
  }

  act(action: Action): Promise<ActResult> {
    return this.request<ActResult>("ACT", { action });
  }

  requestConfirm(action: Action, reason: string): Promise<boolean> {
    // Gebruik een ruimere timeout voor confirm: de mens heeft meer tijd nodig.
    // Bij time-out geven we FALSE terug (veilig-dicht), maar loggen "geen antwoord"
    // zodat het onderscheid met een expliciete weigering zichtbaar blijft.
    return this.request<{ approved: boolean }>(
      "REQUEST_CONFIRM",
      { action, reason },
      120_000,
    ).then(
      (p) => p.approved,
      (err: Error) => {
        if (err.message.includes("time-out")) {
          this.log("confirm: geen antwoord binnen 120s — behandeld als geweigerd");
        }
        return false; // fail-closed
      },
    );
  }

  update(u: { status: RunStatus; step?: number; message: string; action?: Action }): void {
    this.send(brainMessage("RUN_UPDATE", u));
  }

  private request<T, K extends RequestType = RequestType>(
    type: K,
    payload: BrainPayloads[K],
    timeoutMs = 30_000,
  ): Promise<T> {
    const msg = brainMessage(type, payload);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msg.id);
        reject(new Error(`time-out wachtend op antwoord op ${type}`));
      }, timeoutMs);
      this.pending.set(msg.id, { resolve: resolve as (p: unknown) => void, reject, timer });
      this.send(msg as BrainMessage);
    });
  }
}
