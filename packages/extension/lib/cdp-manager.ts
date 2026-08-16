import type { CdpConsoleEntry, CdpInterceptedRequest, CdpNetworkEntry, CdpWebSocketFrame } from "@yad/shared";

/**
 * CDP-manager: beheert chrome.debugger-sessies per tab.
 *
 * Biedt voor bug bounty:
 *  - start_capture: HTTP-requests + response-bodies + console logs + WebSocket frames
 *  - stop_capture:  geeft alle gevangen data terug als gestructureerde JSON
 *  - evaluate:      voert JavaScript uit in de pagina-context (zoals DevTools Console)
 *  - get_response_body: haalt response-body op voor een specifiek requestId
 */

const captured = new Map<string, CdpNetworkEntry>();
const capturedConsole: CdpConsoleEntry[] = [];
const capturedWebSockets = new Map<string, { url: string; frames: CdpWebSocketFrame[] }>();
let captureFilter: string | null = null;
let captureTabId: number | null = null;
const attached = new Set<number>();

async function safeDetach(tabId: number): Promise<void> {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* tab al gesloten of debugger al losgemaakt */
  }
}

async function ensureAttached(tabId: number): Promise<void> {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  attached.add(tabId);
  // Page-domein aanzetten zodat we javascriptDialogOpening binnenkrijgen. Zonder dit
  // bevriest de hele tab op een confirm() en blijft /status ten onrechte groen melden.
  try {
    await chrome.debugger.sendCommand({ tabId }, "Page.enable", {});
  } catch {
    /* Page.enable kan falen op bijzondere tabs; de rest blijft gewoon werken */
  }
  if (!cdpListenerRegistered) {
    chrome.debugger.onEvent.addListener(onCdpEvent);
    chrome.debugger.onDetach.addListener(({ tabId: tid }) => {
      if (tid !== undefined) attached.delete(tid);
      if (tid === captureTabId) {
        captureTabId = null;
        captureFilter = null;
      }
    });
    cdpListenerRegistered = true;
  }
}

let cdpListenerRegistered = false;

/**
 * Hoe we omgaan met een dialoogvenster. Standaard veilig: alleen `alert` wordt
 * geaccepteerd (die heeft geen andere knop), de rest wordt geannuleerd omdat annuleren
 * de niet-destructieve keuze is. Een "verwijder alles?" automatisch bevestigen is
 * precies wat je niet wilt. Een taak die bewust moet bevestigen zet de stand om.
 */
type DialogPolicy = "safe" | "accept-all" | "dismiss-all";
let dialogPolicy: DialogPolicy = "safe";

/** De laatste vensters, zodat het brein weet dat ze er waren en wat erin stond. */
export interface SeenDialog { type: string; message: string; accepted: boolean; at: number }
const recentDialogs: SeenDialog[] = [];

export function setDialogPolicy(p: DialogPolicy): void {
  dialogPolicy = p;
}

export function takeRecentDialogs(): SeenDialog[] {
  return recentDialogs.splice(0, recentDialogs.length);
}

function onCdpEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params: unknown,
): void {
  const tabId = source.tabId;

  // Dialoogvensters MOETEN vóór de capture-filter worden afgehandeld. Ze kunnen op elke
  // aangesloten tab opduiken, ook op een die we niet aan het opnemen zijn, en een
  // onafgehandeld venster bevriest die tab volledig.
  if (method === "Page.javascriptDialogOpening" && tabId != null) {
    const d = params as { type?: string; message?: string };
    const type = String(d.type ?? "confirm");
    // `alert` heeft alleen een OK-knop; die kun je niet zinvol annuleren.
    const accept =
      dialogPolicy === "accept-all" ? true :
      dialogPolicy === "dismiss-all" ? false :
      type === "alert";
    recentDialogs.push({ type, message: String(d.message ?? ""), accepted: accept, at: Date.now() });
    if (recentDialogs.length > 20) recentDialogs.shift();
    void chrome.debugger
      .sendCommand({ tabId }, "Page.handleJavaScriptDialog", { accept })
      .catch(() => { /* venster was al weg */ });
    return;
  }

  if (tabId == null || tabId !== captureTabId) return;
  const p = params as Record<string, unknown>;

  switch (method) {
    case "Network.requestWillBeSent": {
      const req = p["request"] as Record<string, unknown> | undefined;
      const url = String(p["documentURL"] ?? req?.["url"] ?? "");
      if (captureFilter && !url.includes(captureFilter)) return;
      const entry: CdpNetworkEntry = {
        requestId: String(p["requestId"]),
        method: String(req?.["method"] ?? "GET"),
        url: String(req?.["url"] ?? url),
        requestHeaders: flattenHeaders(req?.["headers"]),
        timestamp: Date.now(),
      };
      const postData = req?.["postData"];
      if (typeof postData === "string" && postData.length > 0) {
        entry.requestBody = postData.slice(0, 8_000);
      }
      captured.set(entry.requestId, entry);
      break;
    }
    case "Network.responseReceived": {
      const id = String(p["requestId"]);
      const entry = captured.get(id);
      if (!entry) return;
      const resp = p["response"] as Record<string, unknown> | undefined;
      entry.status = Number(resp?.["status"] ?? 0);
      entry.mimeType = String(resp?.["mimeType"] ?? "");
      entry.responseHeaders = flattenHeaders(resp?.["headers"]);
      captured.set(id, entry);
      break;
    }
    case "Network.loadingFinished": {
      const id = String(p["requestId"]);
      const entry = captured.get(id);
      if (!entry || entry.responseBody !== undefined) return;
      if (!captureTabId) return;
      const tid = captureTabId;
      void chrome.debugger
        .sendCommand({ tabId: tid }, "Network.getResponseBody", { requestId: id })
        .then((r) => {
          const body = r as { body?: string; base64Encoded?: boolean };
          const text = body.body ?? "";
          const existing = captured.get(id);
          if (existing) {
            existing.responseBody = body.base64Encoded
              ? `[base64:${text.slice(0, 200)}...]`
              : text.slice(0, 32_000);
            captured.set(id, existing);
          }
        })
        .catch(() => {});
      break;
    }
    case "Network.webSocketCreated": {
      const wsId = String(p["requestId"]);
      const wsUrl = String(p["url"] ?? "");
      if (captureFilter && !wsUrl.includes(captureFilter)) return;
      capturedWebSockets.set(wsId, { url: wsUrl, frames: [] });
      break;
    }
    case "Network.webSocketFrameReceived": {
      const wsId = String(p["requestId"]);
      const ws = capturedWebSockets.get(wsId);
      if (!ws) return;
      const resp = p["response"] as Record<string, unknown> | undefined;
      ws.frames.push({
        requestId: wsId,
        url: ws.url,
        direction: "received",
        payload: String(resp?.["payloadData"] ?? "").slice(0, 16_000),
        timestamp: Date.now(),
      });
      break;
    }
    case "Network.webSocketFrameSent": {
      const wsId = String(p["requestId"]);
      const ws = capturedWebSockets.get(wsId);
      if (!ws) return;
      const resp = p["response"] as Record<string, unknown> | undefined;
      ws.frames.push({
        requestId: wsId,
        url: ws.url,
        direction: "sent",
        payload: String(resp?.["payloadData"] ?? "").slice(0, 16_000),
        timestamp: Date.now(),
      });
      break;
    }
    case "Runtime.consoleAPICalled": {
      const type = String(p["type"] ?? "log") as CdpConsoleEntry["type"];
      const rawArgs = (p["args"] as Array<Record<string, unknown>> | undefined) ?? [];
      const args = rawArgs
        .map((a) => {
          if (a["value"] !== undefined) return JSON.stringify(a["value"]);
          return String(a["description"] ?? a["value"] ?? "");
        })
        .slice(0, 20);
      capturedConsole.push({ type, args, timestamp: Date.now() });
      break;
    }
  }
}

function flattenHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    result[k.toLowerCase()] = String(v);
  }
  return result;
}

// ──────────────────────────────────────────────
// Publieke API
// ──────────────────────────────────────────────

/**
 * Zorgt dat dialoogvensters op deze tab worden afgehandeld, ook zonder dat er verder
 * iets met CDP gebeurt.
 *
 * WAAROM APART: de afhandeling zat in `ensureAttached`, en die draait pas bij een
 * CDP-commando. Bij een gewone klik-actie is er geen debugger, dus geen Page-domein, dus
 * geen javascriptDialogOpening, en dan bevriest de tab alsnog op een confirm(). Mijn
 * eerste test slaagde puur omdat er vlak daarvoor toevallig een /cdp/evaluate was
 * gedaan; de capaciteitsproef viel er meteen over. Een reparatie die afhangt van iets
 * ongerelateerds is geen reparatie.
 *
 * Mislukken is geen ramp: op chrome:// en Web Store-pagina's mag een extensie niet
 * aankoppelen. Dan werkt de rest gewoon door, alleen zonder dialoogvangnet.
 */
export async function zorgVoorDialoogVangnet(tabId: number): Promise<boolean> {
  try {
    await ensureAttached(tabId);
    return true;
  } catch {
    return false;
  }
}

export async function startCapture(tabId: number, urlFilter?: string): Promise<void> {
  if (captureTabId !== null && captureTabId !== tabId) {
    await stopCapture();
  }
  await ensureAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
    maxResourceBufferSize: 10 * 1024 * 1024,
    maxTotalBufferSize: 50 * 1024 * 1024,
  });
  await chrome.debugger.sendCommand({ tabId }, "Runtime.enable", {});
  captureTabId = tabId;
  captureFilter = urlFilter ?? null;
  captured.clear();
  capturedConsole.length = 0;
  capturedWebSockets.clear();
}

export async function stopCapture(): Promise<{
  requests: CdpNetworkEntry[];
  consoleEntries: CdpConsoleEntry[];
  webSocketFrames: CdpWebSocketFrame[];
}> {
  const requests = Array.from(captured.values());
  const consoleEntries = [...capturedConsole];
  const webSocketFrames = Array.from(capturedWebSockets.values()).flatMap((ws) => ws.frames);
  captured.clear();
  capturedConsole.length = 0;
  capturedWebSockets.clear();
  if (captureTabId !== null) {
    try {
      await chrome.debugger.sendCommand({ tabId: captureTabId }, "Network.disable", {});
    } catch {}
    try {
      await chrome.debugger.sendCommand({ tabId: captureTabId }, "Runtime.disable", {});
    } catch {}
    await safeDetach(captureTabId);
    captureTabId = null;
    captureFilter = null;
  }
  return { requests, consoleEntries, webSocketFrames };
}

// Lees gevangen requests zonder capture te stoppen of de Map te wissen.
// filter = optionele URL-substring (bv. "game/json" of "api/v1").
export function peekNetworkRequests(filter?: string): CdpNetworkEntry[] {
  const all = Array.from(captured.values());
  if (!filter) return all;
  return all.filter((e) => e.url.includes(filter));
}

export async function evaluateInPage(
  tabId: number,
  expression: string,
): Promise<{ value: string; valueType: string; error?: string }> {
  await ensureAttached(tabId);
  try {
    const r = (await chrome.debugger.sendCommand(
      { tabId },
      "Runtime.evaluate",
      {
        expression: expression.slice(0, 4_000),
        returnByValue: true,
        awaitPromise: true,
        timeout: 10_000,
      },
    )) as {
      result?: { type?: string; value?: unknown; description?: string };
      exceptionDetails?: { text?: string };
    };
    if (r.exceptionDetails) {
      return {
        value: r.exceptionDetails.text ?? "runtime error",
        valueType: "error",
        error: r.exceptionDetails.text,
      };
    }
    const val = r.result?.value;
    return {
      value:
        val === undefined
          ? (r.result?.description ?? "undefined")
          : JSON.stringify(val).slice(0, 8_000),
      valueType: r.result?.type ?? "undefined",
    };
  } finally {
    if (tabId !== captureTabId) await safeDetach(tabId);
  }
}

export async function getResponseBody(
  tabId: number,
  requestId: string,
): Promise<{ body: string; base64Encoded: boolean }> {
  if (!attached.has(tabId)) {
    throw new Error("debugger niet bevestigd op deze tab — start eerst een capture");
  }
  const r = (await chrome.debugger.sendCommand(
    { tabId },
    "Network.getResponseBody",
    { requestId },
  )) as { body?: string; base64Encoded?: boolean };
  return {
    body: (r.body ?? "").slice(0, 500_000),
    base64Encoded: r.base64Encoded ?? false,
  };
}

// ──────────────────────────────────────────────
// Request Interception (Fetch domain)
// ──────────────────────────────────────────────

let interceptTabId: number | null = null;
let interceptFilter: string | null = null;
// Queue van onderschepte requests die wachten op intercept_continue.
// Key = requestId, Value = { resolve, tabId }
const interceptPending = new Map<string, (action: "continue" | "block", overrides?: {
  responseCode?: number; responseHeaders?: Array<{ name: string; value: string }>; body?: string;
  requestHeaders?: Array<{ name: string; value: string }>;
}) => void>();

// Callback die de native-port aanroept als er een request wordt onderschept.
// Wordt gezet door setupIntercept() en gereset door clearIntercept().
let onIntercepted: ((req: CdpInterceptedRequest) => void) | null = null;

function onFetchEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params: unknown,
): void {
  if (source.tabId !== interceptTabId) return;
  if (method !== "Fetch.requestPaused") return;
  const p = params as Record<string, unknown>;
  const requestId = String(p["requestId"]);
  const req2 = p["request"] as Record<string, unknown> | undefined;
  const intercepted: CdpInterceptedRequest = {
    requestId,
    url: String(req2?.["url"] ?? ""),
    method: String(req2?.["method"] ?? "GET"),
    headers: flattenHeaders(req2?.["headers"]),
    postData: typeof req2?.["postData"] === "string" ? req2["postData"].slice(0, 8_000) : undefined,
    resourceType: String(p["resourceType"] ?? ""),
  };
  if (interceptFilter && !intercepted.url.includes(interceptFilter)) {
    // URL niet in filter → automatisch doorgaan
    void chrome.debugger.sendCommand({ tabId: interceptTabId! }, "Fetch.continueRequest", { requestId });
    return;
  }
  // Sla de resolve-functie op zodat intercept_continue hem later kan oproepen
  interceptPending.set(requestId, (action, overrides) => {
    const tid = interceptTabId;
    if (!tid) return;
    if (action === "block") {
      void chrome.debugger.sendCommand({ tabId: tid }, "Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
    } else if (overrides?.body !== undefined) {
      const bodyB64 = btoa(unescape(encodeURIComponent(overrides.body)));
      void chrome.debugger.sendCommand({ tabId: tid }, "Fetch.fulfillRequest", {
        requestId,
        responseCode: overrides.responseCode ?? 200,
        responseHeaders: overrides.responseHeaders ?? [{ name: "content-type", value: "application/json" }],
        body: bodyB64,
      });
    } else {
      void chrome.debugger.sendCommand({ tabId: tid }, "Fetch.continueRequest", {
        requestId,
        headers: overrides?.requestHeaders,
      });
    }
    interceptPending.delete(requestId);
  });
  if (onIntercepted) onIntercepted(intercepted);
}

let fetchListenerRegistered = false;

export async function enableIntercept(
  tabId: number,
  urlFilter: string | undefined,
  onRequest: (req: CdpInterceptedRequest) => void,
): Promise<void> {
  if (interceptTabId !== null && interceptTabId !== tabId) {
    await disableIntercept();
  }
  await ensureAttached(tabId);
  interceptTabId = tabId;
  interceptFilter = urlFilter ?? null;
  onIntercepted = onRequest;
  interceptPending.clear();
  if (!fetchListenerRegistered) {
    chrome.debugger.onEvent.addListener(onFetchEvent);
    fetchListenerRegistered = true;
  }
  await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
    patterns: [{ urlPattern: urlFilter ? `*${urlFilter}*` : "*", requestStage: "Request" }],
  });
}

export async function disableIntercept(): Promise<void> {
  if (interceptTabId === null) return;
  try {
    await chrome.debugger.sendCommand({ tabId: interceptTabId }, "Fetch.disable", {});
  } catch {}
  // Alle openstaande requests automatisch doorgaan
  for (const [rid, resolve] of interceptPending) {
    resolve("continue");
    interceptPending.delete(rid);
  }
  interceptTabId = null;
  interceptFilter = null;
  onIntercepted = null;
}

export function continueIntercept(
  requestId: string,
  action: "continue" | "block",
  overrides?: { responseCode?: number; responseHeaders?: Array<{ name: string; value: string }>; body?: string; requestHeaders?: Array<{ name: string; value: string }> },
): boolean {
  const resolve = interceptPending.get(requestId);
  if (!resolve) return false;
  resolve(action, overrides);
  return true;
}

// ──────────────────────────────────────────────
// Cookies via CDP
// ──────────────────────────────────────────────

export async function getCookies(
  tabId: number,
): Promise<Array<{ name: string; value: string; domain: string; path: string; httpOnly: boolean; secure: boolean }>> {
  await ensureAttached(tabId);
  try {
    const r = (await chrome.debugger.sendCommand({ tabId }, "Network.getCookies", {})) as {
      cookies?: Array<{ name: string; value: string; domain: string; path: string; httpOnly: boolean; secure: boolean }>;
    };
    return (r.cookies ?? []).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
    }));
  } finally {
    if (tabId !== captureTabId && tabId !== interceptTabId) await safeDetach(tabId);
  }
}

export async function setCookies(
  tabId: number,
  cookies: Array<{ name: string; value: string; domain?: string; path?: string }>,
  url?: string,
): Promise<void> {
  await ensureAttached(tabId);
  for (const cookie of cookies) {
    await chrome.debugger.sendCommand({ tabId }, "Network.setCookie", {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path ?? "/",
      url,
    });
  }
  if (tabId !== captureTabId && tabId !== interceptTabId) await safeDetach(tabId);
}
