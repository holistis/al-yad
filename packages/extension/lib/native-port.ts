import { handMessage, isEnvelope, type Action, type Snapshot } from "@yad/shared";

/**
 * Beheert de native-messaging-poort naar het Brein (companion) EN vertaalt de
 * commando's van het Brein naar de browser:
 * - REQUEST_SNAPSHOT -> vraag het content script om perceptie
 * - ACT              -> navigeer (achtergrond) of laat het content script handelen
 * - REQUEST_CONFIRM  -> vraag de sidepanel om bevestiging
 * - RUN_UPDATE       -> stuur voortgang naar de sidepanel
 *
 * De open native-poort houdt de MV3 service worker vanzelf alive.
 */

const HOST = "com.yad.companion";
const EXT_VERSION = "0.1.0";
const HEARTBEAT_MS = 20_000;
const PONG_TIMEOUT_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;

export type ConnStatus = "verbonden" | "verbinden" | "verbroken";

let status: ConnStatus = "verbroken";
let detail: unknown = undefined;
let port: chrome.runtime.Port | null = null;
let backoff = 200;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let lastPongAt = 0;

/** De tab waarop de huidige taak draait (vastgelegd bij de start van de run). */
let runTabId: number | null = null;
/** Openstaande bevestigingsverzoeken (id van het REQUEST_CONFIRM-bericht). */
const confirmPending = new Set<string>();

function setStatus(next: ConnStatus, nextDetail?: unknown): void {
  status = next;
  detail = nextDetail;
  void chrome.runtime.sendMessage({ type: "YAD_STATUS", status, detail }).catch(() => {});
}

export function getStatus(): { status: ConnStatus; detail?: unknown } {
  return { status, detail };
}

function toSidepanel(msg: unknown): void {
  void chrome.runtime.sendMessage(msg).catch(() => {});
}

export function startNativePort(): void {
  connect();
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case "YAD_GET_STATUS":
        sendResponse(getStatus());
        return true;
      case "YAD_GOAL":
        void startGoal(String(msg.goal ?? ""), msg.maxSteps);
        sendResponse({ ok: true });
        return true;
      case "YAD_CONFIRM_RESPONSE":
        if (typeof msg.id === "string" && confirmPending.has(msg.id)) {
          confirmPending.delete(msg.id);
          replyToBrain("CONFIRM_RESULT", { approved: Boolean(msg.approved) }, msg.id);
        }
        return undefined;
      default:
        return undefined;
    }
  });
}

async function startGoal(goal: string, maxSteps?: number): Promise<void> {
  if (!goal.trim() || !port) return;
  runTabId = await captureActiveTab();
  port.postMessage(handMessage("GOAL", { goal, ...(maxSteps ? { maxSteps } : {}) }));
}

async function captureActiveTab(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const id = tabs[0]?.id;
  return typeof id === "number" ? id : null;
}

function connect(): void {
  setStatus("verbinden");
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch {
    scheduleReconnect();
    return;
  }
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);
  port.postMessage(
    handMessage("HELLO", {
      extId: chrome.runtime.id,
      clientVersion: EXT_VERSION,
      capabilities: ["dom"],
    }),
  );
}

function replyToBrain(
  type: "SNAPSHOT_RESULT" | "ACT_RESULT" | "CONFIRM_RESULT",
  payload: object,
  correlationId: string,
): void {
  if (!port) return;
  // payload-vormen matchen de HandPayloads; cast is veilig hier.
  port.postMessage(handMessage(type as "ACT_RESULT", payload as never, correlationId));
}

function onMessage(raw: unknown): void {
  if (!isEnvelope(raw)) return;
  switch (raw.type) {
    case "HELLO_ACK":
      backoff = 200;
      lastPongAt = Date.now();
      setStatus("verbonden", raw.payload);
      startHeartbeat();
      break;
    case "PONG":
      lastPongAt = Date.now();
      break;
    case "ERROR":
      console.error("[yad] companion ERROR", raw.payload);
      break;
    case "REQUEST_SNAPSHOT":
      void handleSnapshot(raw.id);
      break;
    case "ACT":
      void handleAct(raw.id, (raw.payload as { action: Action }).action);
      break;
    case "REQUEST_CONFIRM": {
      const p = raw.payload as { action: Action; reason: string };
      confirmPending.add(raw.id);
      toSidepanel({ type: "YAD_CONFIRM_REQUEST", id: raw.id, action: p.action, reason: p.reason });
      break;
    }
    case "RUN_UPDATE":
      toSidepanel({ type: "YAD_RUN_UPDATE", ...(raw.payload as object) });
      break;
    default:
      break;
  }
}

function errorSnapshot(message: string): Snapshot {
  return { url: "", title: "", nodes: [], textDigest: `FOUT: ${message}` };
}

async function handleSnapshot(corr: string): Promise<void> {
  if (runTabId == null) {
    replyToBrain("SNAPSHOT_RESULT", { snapshot: errorSnapshot("geen actieve tab") }, corr);
    return;
  }
  try {
    const snapshot = (await chrome.tabs.sendMessage(runTabId, { type: "YAD_SNAPSHOT" })) as Snapshot;
    replyToBrain("SNAPSHOT_RESULT", { snapshot }, corr);
  } catch (e) {
    replyToBrain(
      "SNAPSHOT_RESULT",
      { snapshot: errorSnapshot(`content script onbereikbaar (herlaad de pagina): ${(e as Error).message}`) },
      corr,
    );
  }
}

async function handleAct(corr: string, action: Action): Promise<void> {
  if (runTabId == null) {
    replyToBrain("ACT_RESULT", { ok: false, detail: "geen actieve tab" }, corr);
    return;
  }
  try {
    if (action.kind === "navigate") {
      await chrome.tabs.update(runTabId, { url: action.url });
      await waitForLoad(runTabId);
      replyToBrain("ACT_RESULT", { ok: true }, corr);
      return;
    }
    const result = await chrome.tabs.sendMessage(runTabId, { type: "YAD_ACT", action });
    replyToBrain("ACT_RESULT", result as object, corr);
  } catch (e) {
    replyToBrain("ACT_RESULT", { ok: false, detail: (e as Error).message }, corr);
  }
}

async function waitForLoad(tabId: number, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (Date.now() - start > timeoutMs) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        await new Promise((r) => setTimeout(r, 400)); // korte rust voor late scripts
        return;
      }
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

function onDisconnect(): void {
  const lastError = chrome.runtime.lastError;
  port = null;
  stopHeartbeat();
  setStatus("verbroken", lastError?.message);
  scheduleReconnect();
}

function startHeartbeat(): void {
  stopHeartbeat();
  lastPongAt = Date.now();
  heartbeat = setInterval(() => {
    if (!port) return;
    if (Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
      try {
        port.disconnect();
      } catch {
        /* leeg */
      }
      onDisconnect();
      return;
    }
    port.postMessage(handMessage("PING", { t: Date.now() }));
  }, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

function scheduleReconnect(): void {
  const delay = backoff;
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  setTimeout(connect, delay);
}
