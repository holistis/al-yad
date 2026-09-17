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

/**
 * Is de debugger-permissie aanwezig?
 *
 * De winkelversie (Chrome Web Store) wordt gebouwd zonder `debugger`, omdat die permissie
 * netwerk-onderschepping mogelijk maakt en daarmee zwaar wordt beoordeeld. Alles wat de
 * klant echt doet — klikken, typen, lezen, navigeren, downloaden — loopt via het
 * content-script en heeft de debugger niet nodig. Alleen netwerk-inspectie en
 * request-onderschepping vallen weg.
 *
 * Runtime-detectie in plaats van een build-vlag: dan kan er geen versie ontstaan waarin de
 * code denkt dat hij de permissie heeft terwijl het manifest hem niet vraagt.
 */
export function heeftCdp(): boolean {
  return typeof chrome !== "undefined" && typeof chrome.debugger !== "undefined";
}

function eisCdp(): void {
  if (!heeftCdp()) {
    throw new Error(
      "Netwerk-inspectie zit niet in deze versie van Yad. Die vraagt de debugger-permissie, " +
        "en die zit alleen in de volledige versie buiten de Chrome Web Store om.",
    );
  }
}

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
  eisCdp();
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

/**
 * Terugval voor `evaluate` zonder debugger-permissie (de winkelversie).
 *
 * chrome.scripting mag ook in de MAIN-wereld draaien, dus een uitdrukking uitvoeren kan
 * daar ook. Eén echt verschil: Runtime.evaluate van de debugger trekt zich niets aan van
 * het beveiligingsbeleid van de pagina, `new Function` wel. Op sites met een strenge
 * Content-Security-Policy faalt deze terugval dus, en dat melden we eerlijk in plaats van
 * een lege waarde terug te geven die op een gelukte meting lijkt.
 */
async function evalueerViaScripting(
  tabId: number,
  expression: string,
): Promise<{ value: string; valueType: string; error?: string }> {
  try {
    const [uitslag] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [expression.slice(0, 4_000)],
      func: (expr: string) => {
        try {
          // eslint-disable-next-line no-new-func
          const v: unknown = new Function(`return (${expr})`)();
          // Zelfde vorm en zelfde afkapping als de debugger-versie hierboven, anders
          // krijgt de aanroeper stilletjes een ander antwoord afhankelijk van de build.
          return { type: typeof v, value: v === undefined ? "undefined" : JSON.stringify(v).slice(0, 8_000) };
        } catch (e) {
          return { type: "error", value: String(e) };
        }
      },
    });
    const r = uitslag?.result as { type?: string; value?: string } | undefined;
    if (!r) return { value: "", valueType: "undefined", error: "geen resultaat uit de pagina" };
    if (r.type === "error") return { value: "", valueType: "error", error: r.value };
    return { value: r.value ?? "", valueType: r.type ?? "undefined" };
  } catch (e) {
    return {
      value: "",
      valueType: "error",
      error:
        `evaluate lukte niet zonder debugger-permissie (${String(e)}). ` +
        "Op pagina's met een streng beveiligingsbeleid kan dit alleen met de volledige versie.",
    };
  }
}

export async function evaluateInPage(
  tabId: number,
  expression: string,
): Promise<{ value: string; valueType: string; error?: string }> {
  if (!heeftCdp()) return evalueerViaScripting(tabId, expression);
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

type FrameTreeNode = { frame: { id: string; url: string }; childFrames?: FrameTreeNode[] };

function verzamelFrames(node: FrameTreeNode | undefined, out: Array<{ id: string; url: string }>): void {
  if (!node) return;
  out.push(node.frame);
  for (const kind of node.childFrames ?? []) verzamelFrames(kind, out);
}

/**
 * Voert JavaScript uit BINNEN een specifiek (ook cross-origin) iframe, in plaats
 * van in het hoofdframe. Nodig voor Forge/Connect-apps (Atlassian Marketplace-apps
 * draaien vrijwel altijd in zo'n iframe) waarvan de inhoud met gewone `evaluate`
 * onzichtbaar blijft: het hoofdframe kan `iframe.contentDocument` niet uitlezen
 * bij een andere origin (browser-eigen same-origin-policy, geen YAD-beperking),
 * en zelfs `document.querySelector("iframe").contentDocument` geeft dan een lege
 * of foutieve waarde terug — geconstateerd 2026-09-17 bij zowel AI Insights als
 * Automated Release Notes (beide Atlassian Marketplace-apps).
 *
 * Probeert eerst `Page.createIsolatedWorld` (een JS-context BINNEN het doelframe,
 * met volledige DOM-toegang, werkt cross-origin zolang het frame in hetzelfde
 * renderer-proces zit). Chrome's site-isolation zet een cross-origin iframe naar
 * een heel ander domein (zoals een Forge-app op *.atlassian-dev.net binnen een
 * *.atlassian.net-pagina) echter vrijwel altijd in een EIGEN proces — zo'n frame
 * verschijnt dan niet in `Page.getFrameTree` maar als los "target". Valt in dat
 * geval terug op `Target.getTargets` + rechtstreeks attachen op dat target-id.
 * `frameUrlContains` matcht op een deel van de URL van het gezochte (i)frame.
 */
export async function evaluateInFrame(
  tabId: number,
  frameUrlContains: string,
  expression: string,
): Promise<{ value: string; valueType: string; error?: string }> {
  if (!heeftCdp()) {
    return { value: "", valueType: "error", error: "Frame-evaluate vereist de volledige (niet-Store) versie van Yad (debugger-permissie)." };
  }
  await ensureAttached(tabId);
  try {
    const frameTreeResult = (await chrome.debugger.sendCommand(
      { tabId },
      "Page.getFrameTree",
      {},
    )) as { frameTree?: FrameTreeNode };
    const alleFrames: Array<{ id: string; url: string }> = [];
    verzamelFrames(frameTreeResult.frameTree, alleFrames);
    const doel = alleFrames.find((f) => f.url.includes(frameUrlContains));

    if (doel) {
      const wereld = (await chrome.debugger.sendCommand(
        { tabId },
        "Page.createIsolatedWorld",
        { frameId: doel.id, worldName: "yad-frame-probe" },
      )) as { executionContextId: number };
      return await voerRuntimeEvaluateUit({ tabId }, expression, { contextId: wereld.executionContextId });
    }

    // Page.getFrameTree toont alleen frames in HETZELFDE renderer-proces als het
    // hoofdframe. Een cross-origin iframe naar een heel ander domein (zoals een
    // Forge-app op *.atlassian-dev.net binnen een *.atlassian.net-pagina) draait
    // door Chrome's site-isolation vrijwel altijd in een EIGEN proces (out-of-process
    // iframe/OOPIF) — ontdekt 2026-09-17 bij zowel AI Insights als Automated Release
    // Notes. Een DIRECTE chrome.debugger.attach({targetId}) op zo'n sub-target gaf bij
    // een live-test "Not allowed" (-32000): de chrome.debugger-EXTENSIE-API staat dat
    // niet toe, dat is een Chrome-platformgrens, geen YAD-bug. De door Chrome zelf
    // gedocumenteerde weg is Target.setAutoAttach + flat-mode sessionId-routing: blijf
    // aangesloten op het tabblad, en stuur commando's naar het kind-target via
    // {tabId, sessionId} in plaats van een los {targetId}.
    const sessionId = await new Promise<string | null>((resolve) => {
      let klaar = false;
      const eindig = (waarde: string | null) => {
        if (klaar) return;
        klaar = true;
        clearTimeout(timer);
        chrome.debugger.onEvent.removeListener(luisteraar);
        resolve(waarde);
      };
      const timer = setTimeout(() => eindig(null), 5_000);
      const luisteraar = (
        source: chrome.debugger.Debuggee,
        method: string,
        params?: object,
      ): void => {
        if (source.tabId !== tabId || method !== "Target.attachedToTarget") return;
        const info = params as { sessionId?: string; targetInfo?: { url: string; type: string } };
        if (info.targetInfo?.type === "iframe" && info.targetInfo.url.includes(frameUrlContains) && info.sessionId) {
          eindig(info.sessionId);
        }
      };
      chrome.debugger.onEvent.addListener(luisteraar);
      chrome.debugger
        .sendCommand({ tabId }, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
        .catch(() => eindig(null));
    });

    if (!sessionId) {
      return {
        value: "",
        valueType: "error",
        error:
          `geen frame gevonden (ook niet via auto-attach) met url die bevat: ${frameUrlContains}. ` +
          `Same-process frames: ${alleFrames.map((f) => f.url).join(", ") || "geen"}`,
      };
    }
    return await voerRuntimeEvaluateUit({ tabId, sessionId }, expression, {});
  } catch (e) {
    return { value: "", valueType: "error", error: String(e) };
  } finally {
    if (tabId !== captureTabId) await safeDetach(tabId);
  }
}

async function voerRuntimeEvaluateUit(
  debuggee: { tabId: number } | { targetId: string } | { tabId: number; sessionId: string },
  expression: string,
  extra: { contextId?: number },
): Promise<{ value: string; valueType: string; error?: string }> {
  const r = (await chrome.debugger.sendCommand(
    debuggee,
    "Runtime.evaluate",
    {
      expression: expression.slice(0, 4_000),
      ...extra,
      returnByValue: true,
      awaitPromise: true,
      timeout: 10_000,
    },
  )) as { result?: { type?: string; value?: unknown; description?: string }; exceptionDetails?: { text?: string } };
  if (r.exceptionDetails) {
    return { value: r.exceptionDetails.text ?? "runtime error", valueType: "error", error: r.exceptionDetails.text };
  }
  const val = r.result?.value;
  return {
    value:
      val === undefined
        ? (r.result?.description ?? "undefined")
        : JSON.stringify(val).slice(0, 8_000),
    valueType: r.result?.type ?? "undefined",
  };
}

/**
 * Voegt ECHTE, vertrouwde tekst in via CDP's Input-domein, in plaats van via JS
 * (execCommand/dispatchEvent). Nodig voor editors die hun eigen interne state
 * bijhouden los van de DOM (Draft.js — X/Twitter en Medium gebruiken het allebei):
 * die editors zien een JS-niveau tekstinvoeging simpelweg niet, en de Post/Publish-knop
 * blijft dan disabled ook al staat de tekst zichtbaar in het veld. Een synthetisch
 * ClipboardEvent('paste') lost dit ook niet op — browsers weigeren principieel om
 * een script-gemaakt paste-event als vertrouwd te behandelen.
 *
 * `Input.insertText` en `Input.dispatchKeyEvent` lopen buiten de pagina-JS om, via
 * hetzelfde kanaal als een echte gebruiker-input, en worden daarom wél als trusted
 * behandeld. Focussen en (optioneel) de bestaande inhoud selecteren/wissen mag wel
 * via JS: dat deel wordt door geen enkele browser als vertrouwens-gevoelig gezien,
 * alleen het ECHTE invoegen van tekst is dat.
 */
export async function insertRealTextInPage(
  tabId: number,
  selector: string,
  text: string,
  opts?: { clearFirst?: boolean },
): Promise<{ ok: boolean; detail?: string }> {
  if (!heeftCdp()) {
    return { ok: false, detail: "Echte tekst-invoer vereist de volledige (niet-Store) versie van Yad (debugger-permissie)." };
  }
  await ensureAttached(tabId);
  try {
    const focusExpr = `(function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, detail: 'element niet gevonden: ' + ${JSON.stringify(selector)} };
      el.focus();
      ${opts?.clearFirst ? `
      if (typeof el.value === 'string' && el.tagName !== 'DIV') {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, ''); else el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      ` : ""}
      return { ok: true };
    })()`;
    const focusResult = (await chrome.debugger.sendCommand(
      { tabId },
      "Runtime.evaluate",
      { expression: focusExpr, returnByValue: true, awaitPromise: true, timeout: 10_000 },
    )) as { result?: { value?: { ok: boolean; detail?: string } }; exceptionDetails?: { text?: string } };
    const focusValue = focusResult.result?.value;
    if (focusResult.exceptionDetails || !focusValue?.ok) {
      return { ok: false, detail: focusValue?.detail ?? focusResult.exceptionDetails?.text ?? "focus/selecteer-stap mislukte" };
    }

    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 0) {
        await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text: lines[i] });
      }
      if (i < lines.length - 1) {
        // Echte Enter-toetsaanslag i.p.v. het teken "\n" in de tekst — Input.insertText
        // behandelt newlines niet betrouwbaar als paragraaf-break in elke editor.
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
          type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
        });
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
          type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
        });
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e) };
  } finally {
    if (tabId !== captureTabId) await safeDetach(tabId);
  }
}

/**
 * Voert een ECHTE, vertrouwde muisklik uit via CDP's Input-domein, in plaats van een
 * JS-niveau click()/dispatchEvent(). Nodig voor componenten die op `event.isTrusted`
 * controleren voordat ze reageren (steeds gangbaarder bij React/MUI-achtige custom
 * dropdowns/comboboxen — geconstateerd op 2026-09-16 bij Atlassian Marketplace,
 * Telegram Web en een Freshworks MUI Select: dezelfde synthetische click werkte niet,
 * en een OS-niveau klik via `user32.dll`/PowerShell bleek onbetrouwbaar zodra DPI-
 * schaling, vensterfocus-timing of scroll-positie niet exact klopten).
 *
 * `Input.dispatchMouseEvent` loopt, net als `Input.insertText`, buiten de pagina-JS
 * om via hetzelfde kanaal als een echte gebruiker-actie, en wordt daarom wél als
 * trusted behandeld — zonder de coordinaten-omrekening (viewport → scherm-pixels)
 * die een OS-niveau klik nodig heeft. `selector` wordt gebruikt om het element te
 * vinden en zo nodig in beeld te scrollen; de klik-coordinaten worden pas ná die
 * scroll opnieuw opgemeten, zodat een eerdere `getBoundingClientRect()`-meting nooit
 * verstald raakt. Controleert daarna met `elementFromPoint` of het doelwit ook echt
 * het TOPMOST element op die coordinaat is — anders wordt duidelijk gefaald met de
 * naam van het overlappende element, in plaats van blind op iets anders te klikken
 * (zoals vandaag gebeurde toen een cookie-banner boven een formulierveld lag).
 *
 * Activeert het tabblad EERST (`chrome.tabs.update({ active: true })`): een
 * tabblad met `document.visibilityState === 'hidden'` (bijvoorbeeld geopend via
 * `/navigate`, dat bewust een onzichtbaar tabblad aanmaakt) doet niet mee aan
 * Chrome's echte input/hit-testing-pipeline — `Input.dispatchMouseEvent` compileert
 * dan zonder fout, maar er komt geen enkel muis-event op de pagina aan, ongeacht de
 * coordinaten. `Runtime.evaluate` heeft dit probleem niet (puur JS, geen rendering
 * nodig), wat het bij een eerste live-test leek alsof alleen deze functie kapot was.
 */
export async function clickRealPositionInPage(
  tabId: number,
  selector: string,
  explicitCoords?: { x: number; y: number },
): Promise<{ ok: boolean; detail?: string }> {
  if (!heeftCdp()) {
    return { ok: false, detail: "Echte klik vereist de volledige (niet-Store) versie van Yad (debugger-permissie)." };
  }
  // Input.dispatchMouseEvent werkt alleen op het ECHT zichtbare tabblad — een tabblad
  // met document.visibilityState 'hidden' (bijvoorbeeld geopend via /navigate, dat
  // bewust een onzichtbaar tabblad aanmaakt) neemt niet deel aan Chrome's echte
  // input/hit-testing-pipeline, ongeacht welke coordinaten je meestuurt. Ontdekt
  // 2026-09-16 bij de live-test van deze functie: Runtime.evaluate werkte prima op de
  // achtergrond-tab (puur JS, geen rendering nodig), maar geen van de gedispatchte
  // muis-events kwam ooit aan op de pagina, ook niet op een simpel <body>-element.
  await chrome.tabs.update(tabId, { active: true });
  await ensureAttached(tabId);
  try {
    let x: number, y: number;
    if (explicitCoords) {
      // `explicitCoords` slaat de selector-opzoek op het HOOFDframe helemaal over —
      // nodig om te klikken op iets BINNEN een cross-origin iframe (document.querySelector
      // op het hoofdframe kan dat element nooit vinden, same-origin-policy). De aanroeper
      // rekent de coordinaat zelf uit (element-rect BINNEN de iframe via evaluate-frame,
      // plus de iframe-eigen positie op het hoofdframe). Ontdekt 2026-09-17: een echte
      // OS-niveau klik (user32.dll) op zo'n berekende coordinaat landt weliswaar op het
      // juiste element (bevestigd met elementFromPoint), maar registreert niet — een CDP-
      // niveau Input.dispatchMouseEvent (deze functie) werkt daar wél, vermoedelijk omdat
      // een cross-process iframe een eigen compositor-surface heeft die anders reageert
      // op OS-niveau input dan op browser-eigen CDP-input.
      ({ x, y } = explicitCoords);
    } else {
      const rectExpr = `(function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, detail: 'element niet gevonden: ' + ${JSON.stringify(selector)} };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return { ok: false, detail: 'element heeft geen zichtbare afmeting (width/height 0)' };
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        const top = document.elementFromPoint(x, y);
        if (!top || !(top === el || el.contains(top) || top.contains(el))) {
          const beschrijving = top ? (top.tagName + (top.id ? '#' + top.id : '') + (top.className ? '.' + String(top.className).split(' ')[0] : '')) : 'niets';
          return { ok: false, detail: 'een ander element (' + beschrijving + ') ligt boven op het doelwit op dit punt, klik zou het verkeerde element raken' };
        }
        return { ok: true, x, y };
      })()`;
      const rectResult = (await chrome.debugger.sendCommand(
        { tabId },
        "Runtime.evaluate",
        { expression: rectExpr, returnByValue: true, awaitPromise: true, timeout: 10_000 },
      )) as { result?: { value?: { ok: boolean; detail?: string; x?: number; y?: number } }; exceptionDetails?: { text?: string } };
      const rectValue = rectResult.result?.value;
      if (rectResult.exceptionDetails || !rectValue?.ok) {
        return { ok: false, detail: rectValue?.detail ?? rectResult.exceptionDetails?.text ?? "coordinaten-opzoek mislukte" };
      }
      ({ x, y } = rectValue as { x: number; y: number });
    }

    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseMoved", x, y,
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed", x, y, button: "left", clickCount: 1,
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y, button: "left", clickCount: 1,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e) };
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
