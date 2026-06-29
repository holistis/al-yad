import { handMessage, isEnvelope, type Action, type Snapshot } from "@yad/shared";
import { isAccepted } from "./acceptance";

/**
 * Beheert de native-messaging-poort naar het Brein (companion) EN vertaalt de
 * commando's van het Brein naar de browser. De open native-poort houdt de MV3
 * service worker vanzelf alive.
 *
 * Veiligheid: een run start alleen na akkoord (click-wrap) en op een echte
 * web-tab; een gesloten tab breekt de run af; bevestigingen verlopen netjes.
 */

const HOST = "com.yad.companion";
const EXT_VERSION = "0.1.0";
const HEARTBEAT_MS = 20_000;
const PONG_TIMEOUT_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;
const CONFIRM_TIMEOUT_MS = 25_000; // iets korter dan de companion-timeout (30s)
const CONTENT_SCRIPT = "content-scripts/content.js";

export type ConnStatus = "verbonden" | "verbinden" | "verbroken";

let status: ConnStatus = "verbroken";
let detail: unknown = undefined;
let port: chrome.runtime.Port | null = null;
let backoff = 200;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let lastPongAt = 0;

let runTabId: number | null = null;
let lastWebTabId: number | null = null; // de meest recente http/https-tab die de user bezocht
let spaJustNavigated = false;           // SPA pushState gedetecteerd → extra wacht vereist
let runInProgress = false;
const confirmPending = new Set<string>();
const confirmTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

function endRun(): void {
  runInProgress = false;
  runTabId = null;
  for (const t of confirmTimers.values()) clearTimeout(t);
  confirmTimers.clear();
  confirmPending.clear();
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
          clearConfirm(msg.id);
          replyToBrain("CONFIRM_RESULT", { approved: Boolean(msg.approved) }, msg.id);
        }
        return undefined;
      default:
        return undefined;
    }
  });

  // Een gesloten run-tab breekt de lopende run netjes af.
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (lastWebTabId === tabId) lastWebTabId = null;
    if (runInProgress && tabId === runTabId) {
      if (port) port.postMessage(handMessage("ABORT_RUN", { reason: "run-tab gesloten" }));
      toSidepanel({ type: "YAD_RUN_UPDATE", status: "gestopt", message: "De tab is gesloten; de taak is gestopt." });
      endRun();
    }
  });

  // Bijhouden welke web-tab de user het meest recent actief had.
  // Zo weet startGoal de doeltab, ook als het side-panel de focus heeft.
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab.url && /^https?:\/\//i.test(tab.url)) lastWebTabId = tabId;
    });
  });
  chrome.tabs.onUpdated.addListener((_tabId, _info, tab) => {
    if (tab.active && tab.url && /^https?:\/\//i.test(tab.url) && typeof tab.id === "number") {
      lastWebTabId = tab.id;
    }
  });

  // SPA-navigatie: history.pushState houdt tab.status === 'complete', dus
  // waitForLoad() eindigt meteen terwijl React/Vue de nieuwe pagina nog opbouwt.
  // We voegen een korte extra wacht in zodat het content-script een frisse snapshot geeft.
  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (runInProgress && details.tabId === runTabId && details.frameId === 0) {
      spaJustNavigated = true;
    }
  });
}

async function startGoal(goal: string, maxSteps?: number): Promise<void> {
  if (!goal.trim() || !port) return;

  if (runInProgress) {
    toSidepanel({ type: "YAD_RUN_UPDATE", status: "geweigerd", message: "Er loopt al een taak." });
    return;
  }
  if (!(await isAccepted())) {
    toSidepanel({
      type: "YAD_RUN_UPDATE",
      status: "geweigerd",
      message: "Akkoord vereist: ga eerst akkoord met de voorwaarden voordat je een taak start.",
    });
    return;
  }

  const tabId = await captureActiveWebTab();
  if (tabId == null) {
    toSidepanel({
      type: "YAD_RUN_UPDATE",
      status: "geweigerd",
      message: "Geen geschikte web-pagina actief (open een http/https-pagina en klik op Start).",
    });
    return;
  }

  runTabId = tabId;
  runInProgress = true;
  port.postMessage(handMessage("GOAL", { goal, ...(maxSteps ? { maxSteps } : {}) }));
}

async function captureActiveWebTab(): Promise<number | null> {
  // Poging 1: actieve tab in het laatste gefocuste window.
  const focused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const ft = focused[0];
  if (ft && typeof ft.id === "number" && ft.url && /^https?:\/\//i.test(ft.url)) return ft.id;

  // Poging 2: de meest recent bezochte web-tab (opgeslagen via onActivated/onUpdated).
  // Vangt het geval op dat het side-panel zelf de focus heeft.
  if (lastWebTabId != null) {
    try {
      const known = await chrome.tabs.get(lastWebTabId);
      if (known.url && /^https?:\/\//i.test(known.url)) return lastWebTabId;
    } catch {
      lastWebTabId = null; // tab is weg
    }
  }

  // Poging 3: zoek over alle windows naar de meest recent actieve http/https-tab.
  const all = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  if (!all.length) return null;
  all.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const best = all[0];
  if (typeof best.id === "number") {
    lastWebTabId = best.id;
    return best.id;
  }
  return null;
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
  port.postMessage(handMessage(type as "ACT_RESULT", payload as never, correlationId));
}

function clearConfirm(id: string): void {
  const t = confirmTimers.get(id);
  if (t) clearTimeout(t);
  confirmTimers.delete(id);
  confirmPending.delete(id);
}

function onMessage(raw: unknown): void {
  if (!isEnvelope(raw)) return;
  switch (raw.type) {
    case "HELLO_ACK":
      backoff = 200;
      lastPongAt = Date.now();
      // Nieuwe verbinding = vers companion-proces: een eerdere run is dood.
      endRun();
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
      const timer = setTimeout(() => {
        if (confirmPending.has(raw.id)) {
          clearConfirm(raw.id);
          toSidepanel({ type: "YAD_CONFIRM_EXPIRED", id: raw.id });
          // NIET automatisch goedkeuren; de companion verloopt vanzelf.
        }
      }, CONFIRM_TIMEOUT_MS);
      confirmTimers.set(raw.id, timer);
      toSidepanel({ type: "YAD_CONFIRM_REQUEST", id: raw.id, action: p.action, reason: p.reason });
      break;
    }
    case "RUN_UPDATE": {
      const p = raw.payload as { status?: string };
      toSidepanel({ type: "YAD_RUN_UPDATE", ...(raw.payload as object) });
      if (p.status && ["klaar", "fout", "gestopt", "geweigerd"].includes(p.status)) {
        endRun();
      }
      break;
    }
    default:
      break;
  }
}

function errorSnapshot(message: string): Snapshot {
  return { url: "", title: "", nodes: [], textDigest: `FOUT: ${message}` };
}

/** Zorgt dat het content script in de tab leeft (injecteer-op-aanvraag). */
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "YAD_PING" });
    return;
  } catch {
    // niet geladen (tab stond al open vóór install/update) -> injecteer
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
}

async function handleSnapshot(corr: string): Promise<void> {
  if (runTabId == null) {
    replyToBrain("SNAPSHOT_RESULT", { snapshot: errorSnapshot("geen actieve tab") }, corr);
    return;
  }
  try {
    await ensureContentScript(runTabId);
    const snapshot = (await chrome.tabs.sendMessage(runTabId, { type: "YAD_SNAPSHOT" })) as Snapshot;
    replyToBrain("SNAPSHOT_RESULT", { snapshot }, corr);
  } catch (e) {
    replyToBrain(
      "SNAPSHOT_RESULT",
      { snapshot: errorSnapshot(`pagina onbereikbaar: ${(e as Error).message}`) },
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
      const completed = await waitForLoad(runTabId);
      replyToBrain(
        "ACT_RESULT",
        completed ? { ok: true } : { ok: false, detail: "navigatie niet voltooid binnen de tijd" },
        corr,
      );
      return;
    }
    await ensureContentScript(runTabId);
    const result = await chrome.tabs.sendMessage(runTabId, { type: "YAD_ACT", action });
    replyToBrain("ACT_RESULT", result as object, corr);
  } catch (e) {
    replyToBrain("ACT_RESULT", { ok: false, detail: (e as Error).message }, corr);
  }
}

/** Wacht tot de tab geladen is; geeft false bij time-out of als de tab verdween. */
async function waitForLoad(tabId: number, timeoutMs = 15_000): Promise<boolean> {
  spaJustNavigated = false; // reset vóór we gaan wachten
  const start = Date.now();
  for (;;) {
    if (Date.now() - start > timeoutMs) return false;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        // SPA: als pushState is gevuurd terwijl status al 'complete' was, wacht iets langer
        // zodat het framework de nieuwe pagina-tree kan renderen.
        const extraWait = spaJustNavigated ? 800 : 400;
        spaJustNavigated = false;
        await new Promise((r) => setTimeout(r, extraWait));
        return true;
      }
    } catch {
      return false; // tab weg
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

function onDisconnect(): void {
  const lastError = chrome.runtime.lastError;
  port = null;
  stopHeartbeat();
  endRun();
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
