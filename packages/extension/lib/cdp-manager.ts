import type { CdpNetworkEntry } from "@yad/shared";

/**
 * CDP-manager: beheert chrome.debugger-sessies per tab.
 *
 * Wat dit biedt voor bug bounty:
 *  - start_capture: vangt alle HTTP-verzoeken + responses op (inclusief verborgen API-calls)
 *  - stop_capture:  geeft het volledige overzicht terug als gestructureerde JSON
 *  - evaluate:      voert JavaScript uit in de pagina-context (zoals de DevTools Console)
 *  - get_response_body: haalt de volledige response-body op voor een specifiek verzoek
 *
 * Verschil met DevTools klikken: dit is het protocol ónder DevTools. Alles wat je
 * handmatig in de Network-tab ziet, is hier programmatisch beschikbaar.
 */

/** Interne opslag: requestId → geaggregeerde data per verzoek. */
const captured = new Map<string, CdpNetworkEntry>();
let captureFilter: string | null = null;
let captureTabId: number | null = null;

/** Alle tabs waarop de debugger momenteel is bevestigd. */
const attached = new Set<number>();

/** Verwijder veilig een debugger-bevestiging (negeer al-niet-bevestigde tabs). */
async function safeDetach(tabId: number): Promise<void> {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* tab al gesloten of debugger al losgemaakt */
  }
}

/** Bevestig debugger op een tab als dat nog niet is gebeurd. */
async function ensureAttached(tabId: number): Promise<void> {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  attached.add(tabId);

  // Luister naar CDP-events voor ALLE bevestigde tabs.
  // Dit luisterblok registreert zichzelf eenmalig; daarna filtert het op tabId.
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

/** Verwerkt inkomende CDP-events (voornamelijk Network.*). */
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
      // POST-body (indien aanwezig)
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
      // Response-body automatisch ophalen voor kleine responses (< 1 MB).
      const id = String(p["requestId"]);
      const entry = captured.get(id);
      if (!entry || entry.responseBody !== undefined) return;
      if (!captureTabId) return;
      const tid = captureTabId; // snapshot voor async scope
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
        .catch(() => { /* request al weggegooid — negeer */ });
      break;
    }
  }
}

/** Zet headers-object (Chrome geeft variabele types) om naar Record<string,string>. */
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
 * Start netwerkverkeer vastleggen op een tab.
 * Gooit als de debugger al bezet is door DevTools.
 */
export async function startCapture(tabId: number, urlFilter?: string): Promise<void> {
  // Stop eventuele vorige capture netjes.
  if (captureTabId !== null && captureTabId !== tabId) {
    await stopCapture();
  }
  await ensureAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
    maxResourceBufferSize: 10 * 1024 * 1024, // 10 MB buffer
    maxTotalBufferSize: 50 * 1024 * 1024,
  });
  captureTabId = tabId;
  captureFilter = urlFilter ?? null;
  captured.clear();
}

/**
 * Stop het vastleggen en geeft alle gevangen verzoeken terug.
 * Losmaken van de debugger zodat DevTools weer gebruikt kan worden.
 */
export async function stopCapture(): Promise<CdpNetworkEntry[]> {
  const results = Array.from(captured.values());
  captured.clear();
  if (captureTabId !== null) {
    try {
      await chrome.debugger.sendCommand({ tabId: captureTabId }, "Network.disable", {});
    } catch { /* tab kan al gesloten zijn */ }
    await safeDetach(captureTabId);
    captureTabId = null;
    captureFilter = null;
  }
  return results;
}

/**
 * Voer een JavaScript-expressie uit in de pagina-context van een tab.
 * Gelijkwaardig aan "typ dit in de DevTools Console en druk Enter".
 */
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
      value: val === undefined ? (r.result?.description ?? "undefined") : JSON.stringify(val).slice(0, 8_000),
      valueType: r.result?.type ?? "undefined",
    };
  } finally {
    // Detach alleen als we NIET aan het capturen zijn op deze tab.
    if (tabId !== captureTabId) await safeDetach(tabId);
  }
}

/**
 * Haal de response-body op voor een specifiek requestId.
 * Alleen bruikbaar terwijl de debugger nog bevestigd is (binnen een capture-sessie).
 */
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
