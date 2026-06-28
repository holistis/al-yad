import { handMessage, isEnvelope } from "@yad/shared";

/**
 * Beheert de native-messaging-poort naar het Brein (companion).
 * - Houdt de poort open (dat houdt de MV3 service worker vanzelf alive).
 * - Stuurt HELLO, verwacht HELLO_ACK.
 * - Heartbeat (PING/PONG) elke 20s; bij stilte forceert het een herverbinding.
 * - Herverbindt met exponentiele backoff (200ms..30s).
 *
 * Let op: aan de extensie-kant werken we met JSON-objecten; Chrome doet de
 * native-messaging framing. De companion doet de framing aan zijn stdio-kant.
 */

const HOST = "com.yad.companion";
const EXT_VERSION = "0.1.0";
const HEARTBEAT_MS = 20_000;
const PONG_TIMEOUT_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;

export type ConnStatus = "verbonden" | "verbinden" | "verbroken";

export interface StatusSnapshot {
  status: ConnStatus;
  detail?: unknown;
}

let status: ConnStatus = "verbroken";
let detail: unknown = undefined;
let port: chrome.runtime.Port | null = null;
let backoff = 200;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let lastPongAt = 0;

function setStatus(next: ConnStatus, nextDetail?: unknown): void {
  status = next;
  detail = nextDetail;
  // broadcast naar de sidepanel (faalt stil als er geen luisteraar is)
  void chrome.runtime.sendMessage({ type: "YAD_STATUS", status, detail }).catch(() => {});
}

export function getStatus(): StatusSnapshot {
  return { status, detail };
}

export function startNativePort(): void {
  connect();
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "YAD_GET_STATUS") {
      sendResponse(getStatus());
      return true;
    }
    return undefined;
  });
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
    default:
      break;
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
      // companion reageert niet meer -> forceer herverbinding
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
