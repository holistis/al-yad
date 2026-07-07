import type { CdpConsoleEntry, CdpNetworkEntry, CdpWebSocketFrame } from "@yad/shared";

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

function onCdpEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params: unknown,
): void {
  const tabId = source.tabId;
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
