import {
  brainMessage,
  isEnvelope,
  type Action,
  type ActResult,
  type Attachment,
  type BrainMessage,
  type BrainPayloads,
  type RunStatus,
  type Snapshot,
} from "@yad/shared";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AgentLoop, type HandBridge } from "./agent/loop.js";
import { LlmRouter } from "./engine/router.js";
import { buildPool } from "./engine/pool.js";
import { createHandshakeHandler, type CompanionInfo } from "./handshake.js";
import { saveREDACTEDSession } from "./adapters/REDACTED.js";
import { CacheStore } from "./memory/cache-store.js";
import { REDACTEDSessionReader } from "./key/session-reader.js";
import { RunHistoryStore, type RunHistoryEntry } from "./history/run-history.js";

type RequestType = "REQUEST_SNAPSHOT" | "ACT" | "REQUEST_CONFIRM" | "INJECT_COOKIES" | "INJECT_LOCALSTORAGE";

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
  private defaultMaxSteps = 15;
  private autonomy: "confirm" | "auto" = "confirm";
  private language: "nl" | "en" = "nl";
  private connected = false;
  private pendingCapture: ((path: string) => void) | null = null;
  private pendingCaptureReject: ((e: Error) => void) | null = null;
  // router is niet readonly: UPDATE_CONFIG kan de pool vervangen
  private router: LlmRouter;
  private readonly cacheStore = new CacheStore();
  private readonly sessionReader = new REDACTEDSessionReader();
  private readonly runHistory = new RunHistoryStore();

  constructor(
    private readonly send: (m: BrainMessage) => void,
    router: LlmRouter,
    info: CompanionInfo,
    private readonly log: (m: string) => void = () => {},
  ) {
    this.router = router;
    this.handshake = createHandshakeHandler(info, send, log);
  }

  isConnected(): boolean { return this.connected; }

  captureForClaude(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.pendingCapture = resolve;
      this.pendingCaptureReject = reject;
      this.send(brainMessage("REQUEST_CAPTURE_FOR_CLAUDE", {}));
      setTimeout(() => {
        if (this.pendingCapture) {
          this.pendingCapture = null;
          this.pendingCaptureReject = null;
          reject(new Error("Capture time-out na 15s — is Chrome open met YAD?"));
        }
      }, 15_000);
    });
  }

  triggerGoal(goal: string, startingUrl?: string): void {
    void this.startRun(goal, undefined, undefined, startingUrl);
  }

  handle(raw: unknown): void {
    if (!isEnvelope(raw)) {
      this.handshake(raw);
      return;
    }
    switch (raw.type) {
      case "HELLO":
        this.connected = true;
        this.handshake(raw);
        return;
      case "PING":
        this.handshake(raw);
        return;
      case "GOAL": {
        const p = raw.payload as { goal?: string; maxSteps?: number; attachments?: Attachment[]; startingUrl?: string };
        if (typeof p?.goal === "string") void this.startRun(p.goal, p.maxSteps, p.attachments, p.startingUrl);
        return;
      }
      case "ABORT_RUN": {
        this.aborted = true;
        return;
      }
      case "UPDATE_CONFIG": {
        const p = raw.payload as {
          env: Record<string, string>;
          maxSteps?: number;
          autonomy?: "confirm" | "auto";
          language?: "nl" | "en";
        };
        // Schrijf UI-sleutels over process.env (compatibel met loadEnvFile die ook
        // process.env gebruikt). Lege waarden worden genegeerd zodat de .env-bodem
        // intact blijft: de UI is additief bovenop .env. Een in de UI uitgeschakelde
        // provider die óók in .env staat, blijft dus tot een herstart actief — dat is
        // bewust (we wissen nooit de .env-sleutels van de gebruiker live weg).
        for (const [k, v] of Object.entries(p.env)) {
          if (v) process.env[k] = v;
        }
        if (p.maxSteps && p.maxSteps > 0) this.defaultMaxSteps = p.maxSteps;
        if (p.autonomy === "confirm" || p.autonomy === "auto") this.autonomy = p.autonomy;
        if (p.language === "nl" || p.language === "en") this.language = p.language;
        const newPool = buildPool();
        this.router = new LlmRouter(newPool, { log: (m) => this.log(`[motor] ${m}`) });
        this.log(`config bijgewerkt: ${newPool.map((pr) => pr.name).join(",")} (${newPool.length} providers)`);
        // Stuur actieve providers terug zodat de UI ze kan tonen (geen sleutelwaarden, alleen namen).
        this.send(brainMessage("COMPANION_CONFIG", { activeProviders: newPool.map((pr) => pr.name) }));
        return;
      }
      case "SESSION_CAPTURE": {
        const p = raw.payload as {
          url: string;
          cookieHeader: string;
          localStorage: Record<string, string>;
          label: "A" | "B";
        };
        const result = saveREDACTEDSession(p);
        this.send(brainMessage("SESSION_RESULT", result));
        this.log(
          result.ok
            ? `sessie opgeslagen: ${result.brand} account-${p.label} → ${result.path}`
            : `sessie-fout: ${result.detail}`,
        );
        return;
      }
      case "PAGE_CAPTURE": {
        const p = raw.payload as {
          url: string;
          title: string;
          text: string;
          capturedAt: string;
        };
        const bridgePath = process.env["YAD_BRIDGE_PATH"] ?? "C:\\Code\\yad-claude-bridge.json";
        try {
          mkdirSync(dirname(bridgePath), { recursive: true });
          writeFileSync(bridgePath, JSON.stringify(p, null, 2), "utf-8");
          this.send(brainMessage("CLAUDE_BRIDGE_RESULT", { ok: true, path: bridgePath }));
          this.log(`claude-brug geschreven → ${bridgePath}`);
          if (this.pendingCapture) {
            this.pendingCapture(bridgePath);
            this.pendingCapture = null;
            this.pendingCaptureReject = null;
          }
        } catch (e) {
          const detail = (e as Error).message;
          this.send(brainMessage("CLAUDE_BRIDGE_RESULT", { ok: false, detail }));
          this.log(`claude-brug mislukt: ${detail}`);
          if (this.pendingCaptureReject) {
            this.pendingCaptureReject(e as Error);
            this.pendingCapture = null;
            this.pendingCaptureReject = null;
          }
        }
        return;
      }
      case "SNAPSHOT_RESULT":
      case "ACT_RESULT":
      case "CONFIRM_RESULT":
      case "INJECT_COOKIES_RESULT":
      case "INJECT_LOCALSTORAGE_RESULT": {
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

  private async startRun(goal: string, maxSteps?: number, attachments?: Attachment[], startingUrl?: string): Promise<void> {
    if (this.running) {
      this.update({ status: "fout", message: "Er loopt al een taak." });
      return;
    }
    this.running = true;
    this.aborted = false;
    const runStart = Date.now();
    const runId = Math.random().toString(36).slice(2, 10);

    // Sessie-hergebruik: injecteer opgeslagen cookies + localStorage vóór de loop
    // zodat de agent meteen authenticated is op de site zonder handmatige inlog.
    if (startingUrl) {
      const session = this.sessionReader.findForUrl(startingUrl);
      if (session) {
        if (session.cookies.length > 0) {
          try {
            const r = await this.request<{ ok: boolean; count: number }>("INJECT_COOKIES", {
              url: startingUrl,
              cookies: session.cookies,
            }, 5_000);
            this.log(`cookies geïnjecteerd: ${session.brand} — ${r.count} cookies`);
          } catch (e) {
            this.log(`cookie-injectie mislukt: ${(e as Error).message} (doorgaan zonder)`);
          }
        }
        if (session.localStorageItems && Object.keys(session.localStorageItems).length > 0) {
          try {
            const r = await this.request<{ ok: boolean; count: number }>("INJECT_LOCALSTORAGE", {
              items: session.localStorageItems,
            }, 5_000);
            this.log(`localStorage geïnjecteerd: ${session.brand} — ${r.count} sleutels`);
          } catch (e) {
            this.log(`localStorage-injectie mislukt: ${(e as Error).message} (doorgaan zonder)`);
          }
        }
      }
    }

    const loop = new AgentLoop({ chat: (req) => this.router.chat(req) }, this, {
      log: this.log,
      isAborted: () => this.aborted,
      maxSteps: maxSteps ?? this.defaultMaxSteps,
      autonomy: this.autonomy,
      language: this.language,
      cacheStore: this.cacheStore,
    });
    let outcome: RunHistoryEntry | undefined;
    try {
      const result = await loop.run(goal, maxSteps, attachments);
      outcome = {
        id: runId,
        goal,
        status: result.status,
        steps: result.steps,
        summary: result.summary,
        startedAt: runStart,
        finishedAt: Date.now(),
        startingUrl,
      };
    } catch (e) {
      this.update({ status: "fout", message: (e as Error).message });
      outcome = {
        id: runId,
        goal,
        status: "fout",
        steps: 0,
        startedAt: runStart,
        finishedAt: Date.now(),
        startingUrl,
      };
    } finally {
      this.running = false;
      if (outcome) this.runHistory.append(outcome);
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
