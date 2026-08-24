import { handMessage, isEnvelope, type Action, type Attachment, type Snapshot, settingsToEnv, ENV_KEY_TO_PROVIDER } from "@yad/shared";
import { isAccepted } from "./acceptance";
import { getSettings, saveSettings, getSiteOverrides, addHistoryEntry } from "./storage";
import { captureSession, getActiveWebTab } from "./session-capture";
import { injectCookies, injectLocalStorage } from "./session-inject";
import { startCapture, stopCapture, evaluateInPage, getResponseBody, enableIntercept, disableIntercept, continueIntercept, getCookies, setCookies, peekNetworkRequests, zorgVoorDialoogVangnet } from "./cdp-manager";

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
let stickyTabId: number | null = null;  // de tab waarop YAD het LAATSTE werkte — blijft hangen tussen runs
let lastWebTabId: number | null = null; // de meest recente http/https-tab die de user bezocht
let spaJustNavigated = false;           // SPA pushState gedetecteerd → extra wacht vereist
let runInProgress = false;
const confirmPending = new Set<string>();
const confirmTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Taal voor de meldingen die de gebruiker in het side-panel ziet (run-status en
 * capture-resultaten). Deze module is een service worker zonder eigen currentLanguage,
 * dus we cachen de opgeslagen taalkeuze en verversen hem telkens als we de instellingen
 * al aan het lezen zijn (sendConfigUpdate) of vlak voordat we een melding opbouwen.
 * Model-gerichte details (SNAPSHOT/ACT/CDP) blijven bewust onvertaald.
 */
let uiLang: "nl" | "en" = "nl";
async function refreshUiLang(): Promise<"nl" | "en"> {
  try {
    const s = await getSettings();
    uiLang = s.language === "en" ? "en" : "nl";
  } catch {
    /* instellingen onleesbaar → vorige taal aanhouden */
  }
  return uiLang;
}

const RUN_MSG = {
  nl: {
    tabClosed: "De tab is gesloten; de taak is gestopt.",
    alreadyRunning: "Er loopt al een taak.",
    consentRequired: "Akkoord vereist: ga eerst akkoord met de voorwaarden voordat je een taak start.",
    noTabOpen: "Kon geen tab openen om de taak uit te voeren. Probeer het opnieuw.",
    notConnected: "Niet verbonden met de companion.",
    noWebTab: "Geen actieve web-tab gevonden.",
    noWebTabSession: "Geen actieve web-tab gevonden. Open de site en probeer opnieuw.",
  },
  en: {
    tabClosed: "The tab was closed, so the task has stopped.",
    alreadyRunning: "A task is already running.",
    consentRequired: "Consent required: please accept the terms before you start a task.",
    noTabOpen: "Could not open a tab to run the task. Please try again.",
    notConnected: "Not connected to the companion.",
    noWebTab: "No active web tab found.",
    noWebTabSession: "No active web tab found. Open the site and try again.",
  },
} as const;

function rt(k: keyof typeof RUN_MSG.nl): string {
  return RUN_MSG[uiLang][k];
}

/**
 * Downloads bijhouden.
 *
 * Zonder dit kon YAD wél op een downloadlink klikken, maar daarna niet weten of er iets
 * binnenkwam, hoe het heette of waar het stond. "Haal het rapport op en mail het" is een
 * standaardklus en die was dus onmogelijk.
 *
 * We houden alleen de afgeronde downloads bij, met naam, pad, grootte en de bron-URL.
 * De companion draait op dezelfde machine en kan het bestand daarna gewoon van schijf
 * lezen met zijn bestaande /fs/read-file; het bestand hoeft dus niet door deze pijp.
 *
 * De lijst is bewust klein (laatste 20) en wordt in het geheugen gehouden: een
 * service worker mag afsluiten, en dan is een gemiste download minder erg dan een
 * bestand dat eindeloos in opslag blijft staan.
 */
export interface KlaarDownload {
  id: number;
  filename: string;
  url: string;
  bytes: number;
  mime: string;
  klaarOp: number;
}
const klaarDownloads: KlaarDownload[] = [];
let downloadListenerAan = false;

/**
 * De lijst overleeft nu ook een slapende service worker.
 *
 * GEMETEN, niet vermoed: over vier benchmarkrondes slaagde "downloaden" twee keer en
 * faalde het twee keer, in zowel de winkel- als de volledige build. Steeds met dezelfde
 * melding "niets binnengekomen", terwijl het bestand wél op schijf stond. Dat is geen
 * toeval maar het patroon van MV3: registreren bij het laden van de module zorgt dat
 * Chrome de worker wékt voor de gebeurtenis, maar het geheugen van die worker is weg
 * zodra hij daarna weer afsluit. De vorige reparatie loste de helft van het probleem op.
 *
 * chrome.storage.session in plaats van .local: dit hoort bij deze browsersessie, mag na
 * afsluiten weg, en komt zo niet op schijf te staan. Bestandsnamen van een klant horen
 * niet langer te blijven liggen dan nodig.
 */
const DL_SLEUTEL = "yad_klaar_downloads";

async function bewaarDownloads(lijst: KlaarDownload[]): Promise<void> {
  try {
    await chrome.storage.session.set({ [DL_SLEUTEL]: lijst.slice(-20) });
  } catch {
    /* storage.session ontbreekt in oudere Chrome: dan blijft alleen het geheugen over */
  }
}

async function leesDownloads(): Promise<KlaarDownload[]> {
  try {
    const r = await chrome.storage.session.get(DL_SLEUTEL);
    const bewaard = (r?.[DL_SLEUTEL] as KlaarDownload[] | undefined) ?? [];
    // Samenvoegen op id: het geheugen kan een record hebben dat nog niet is weggeschreven,
    // de opslag kan er een hebben van vóór de laatste herstart van de worker.
    const perId = new Map<number, KlaarDownload>();
    for (const d of [...bewaard, ...klaarDownloads]) perId.set(d.id, d);
    return [...perId.values()].sort((a, b) => a.klaarOp - b.klaarOp);
  } catch {
    return [...klaarDownloads];
  }
}

/**
 * De luisteraar wordt bij het laden van de module geregistreerd, niet pas bij de eerste
 * uitvraag. Dat is geen stijlkwestie maar de manier waarop MV3 werkt: een service worker
 * mag afsluiten, en Chrome wekt hem alleen voor gebeurtenissen waarvan de luisteraar bij
 * het laden bekend was. Registreer je lui, dan mis je precies de download die begon
 * terwijl de worker sliep.
 *
 * Dat is niet theoretisch: de capaciteiten-wacht meldde downloaden als teruggevallen na
 * een run waarin verder niets veranderd was, en dit was de oorzaak.
 */
function volgDownloads(): void {
  if (downloadListenerAan) return;
  if (!chrome.downloads?.onChanged) return; // permissie ontbreekt of oude Chrome
  downloadListenerAan = true;
  chrome.downloads.onChanged.addListener((delta) => {
    // Alleen reageren op de overgang naar "complete". onChanged vuurt ook voor
    // voortgang en dan is `filename` er nog niet, of wijst hij naar het .crdownload-
    // tijdelijke bestand dat straks niet meer bestaat.
    if (delta.state?.current !== "complete") return;
    chrome.downloads.search({ id: delta.id }, (items) => {
      const it = items?.[0];
      if (!it) return;
      klaarDownloads.push({
        id: it.id,
        filename: it.filename ?? "",
        url: it.finalUrl ?? it.url ?? "",
        bytes: it.fileSize ?? it.totalBytes ?? 0,
        mime: it.mime ?? "",
        klaarOp: Date.now(),
      });
      while (klaarDownloads.length > 20) klaarDownloads.shift();
      // Meteen wegschrijven. Wachten tot de uitvraag is precies te laat: de worker mag
      // tussen deze gebeurtenis en die uitvraag afsluiten, en dan is het geheugen leeg.
      void bewaarDownloads(klaarDownloads);
    });
  });
}

// Meteen bij het laden van de module, zodat Chrome de worker wekt voor een download die
// begint terwijl hij slaapt. Zie de uitleg bij volgDownloads.
volgDownloads();

export async function getKlaarDownloads(sinds?: number): Promise<KlaarDownload[]> {
  volgDownloads(); // vangnet: mocht de registratie bij het laden zijn mislukt
  const alle = await leesDownloads();
  return sinds ? alle.filter((d) => d.klaarOp > sinds) : alle;
}

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
  // Onthoud de tab waarop deze run plaatsvond — volgende run start hier ook.
  if (runTabId != null) stickyTabId = runTabId;
  runTabId = null;
  for (const t of confirmTimers.values()) clearTimeout(t);
  confirmTimers.clear();
  confirmPending.clear();
}

/** Wordt aangeroepen vanuit background.ts als de gebruiker op het YAD-icoon klikt op een tab. */
export function setYadTabId(tabId: number): void {
  stickyTabId = tabId;
}

export function startNativePort(): void {
  connect();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case "YAD_GET_STATUS":
        sendResponse(getStatus());
        return true;
      case "YAD_GOAL":
        void startGoal(String(msg.goal ?? ""), msg.maxSteps, msg.attachments as Attachment[] | undefined);
        sendResponse({ ok: true });
        return true;
      case "YAD_CONFIRM_RESPONSE":
        if (typeof msg.id === "string" && confirmPending.has(msg.id)) {
          clearConfirm(msg.id);
          replyToBrain("CONFIRM_RESULT", { approved: Boolean(msg.approved) }, msg.id);
        }
        return undefined;
      case "YAD_UPDATE_CONFIG":
        // Instellingen opgeslagen in de sidepanel → doorsturen naar de companion.
        void sendConfigUpdate();
        sendResponse({ ok: true });
        return true;
      case "YAD_GET_CURRENT_TAB_URL":
        void (async () => {
          const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
          tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
          const url = tabs[0]?.url ?? "";
          sendResponse({ url });
        })();
        return true;
      case "YAD_CAPTURE_SESSION":
        void handleCaptureSession(msg.label as "A" | "B");
        sendResponse({ ok: true });
        return true;
      case "YAD_CAPTURE_FOR_CLAUDE":
        void handleCaptureForClaude();
        sendResponse({ ok: true });
        return true;
      default:
        return undefined;
    }
  });

  // Een gesloten run-tab breekt de lopende run netjes af.
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (lastWebTabId === tabId) lastWebTabId = null;
    if (runInProgress && tabId === runTabId) {
      if (port) port.postMessage(handMessage("ABORT_RUN", { reason: "run-tab gesloten" }));
      toSidepanel({ type: "YAD_RUN_UPDATE", status: "gestopt", message: rt("tabClosed") });
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
  // Guard: als de webNavigation-permissie (nog) niet actief is in deze SW, is de API
  // undefined — dan deze optionele verbetering overslaan i.p.v. de hele init laten crashen.
  if (chrome.webNavigation?.onHistoryStateUpdated) {
    chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
      if (runInProgress && details.tabId === runTabId && details.frameId === 0) {
        spaJustNavigated = true;
      }
    });
  }
}

async function startGoal(goal: string, maxSteps?: number, attachments?: Attachment[]): Promise<void> {
  if (!goal.trim() || !port) return;

  if (runInProgress) {
    toSidepanel({ type: "YAD_RUN_UPDATE", status: "geweigerd", message: rt("alreadyRunning") });
    return;
  }
  // Claim de run SYNCHROON, vóór elke await: anders kunnen twee snel na elkaar
  // binnenkomende GOAL-berichten allebei de guard passeren en elk een tab aanmaken
  // (TOCTOU-race -> ongelimiteerd tabs). JS is single-threaded, dus dit blok is atomair.
  runInProgress = true;

  if (!(await isAccepted())) {
    runInProgress = false;
    toSidepanel({
      type: "YAD_RUN_UPDATE",
      status: "geweigerd",
      message: rt("consentRequired"),
    });
    return;
  }

  const tabId = await resolveRunTab();
  if (tabId == null) {
    runInProgress = false;
    toSidepanel({
      type: "YAD_RUN_UPDATE",
      status: "geweigerd",
      message: rt("noTabOpen"),
    });
    return;
  }

  runTabId = tabId;
  // Meteen het dialoogvangnet leggen, vóór er ook maar één actie gebeurt. Een confirm()
  // bevriest de hele tab, en dan helpt achteraf aankoppelen niet meer. Bewust niet
  // afwachten: de run mag hier niet op wachten, en mislukken (chrome://-pagina's) is
  // geen reden om de run te blokkeren.
  void zorgVoorDialoogVangnet(tabId);
  // Niet automatisch naar voren brengen — YAD werkt op de achtergrond zonder de
  // gebruiker te onderbreken. De run gaat gewoon door op de achtergrond-tab.
  // Startpagina-URL meesturen zodat de companion de juiste sessie kan injecteren.
  let startingUrl: string | undefined;
  try {
    const runTab = await chrome.tabs.get(tabId);
    if (runTab.url && /^https?:\/\//i.test(runTab.url)) startingUrl = runTab.url;
  } catch { /* tab onleesbaar → geen startingUrl */ }
  port.postMessage(handMessage("GOAL", {
    goal,
    ...(startingUrl ? { startingUrl } : {}),
    ...(maxSteps ? { maxSteps } : {}),
    ...(attachments?.length ? { attachments } : {}),
  }));
}

/**
 * Bepaalt de tab waarop de taak draait.
 *
 * Regel: YAD kapt NOOIT de tab van de user. Twee gevallen:
 *   1. stickyTabId aanwezig (user klikte YAD-icoon op die tab, of vorige run zat hier) → gebruik die tab.
 *   2. Geen stickyTabId → maak een EIGEN achtergrond-tab aan (active: false = geen focus-diefstal).
 *
 * De oude "Poging 1: actieve tab" en "Poging 2: lastWebTabId" zijn verwijderd — die
 * kapten de tab waar de user mee bezig was zodra er geen sticky-tab was.
 */
async function resolveRunTab(): Promise<number | null> {
  // Poging 0: sticky tab — door user expliciet gekozen (klik op YAD-icoon op die tab)
  // of overgebleven van de vorige run (endRun() zet stickyTabId = runTabId).
  if (stickyTabId != null) {
    try {
      const known = await chrome.tabs.get(stickyTabId);
      if (known.url && /^https?:\/\//i.test(known.url)) return stickyTabId;
    } catch {
      stickyTabId = null; // tab bestaat niet meer → val door naar nieuwe tab
    }
  }

  // Poging 1: maak een EIGEN YAD-tab aan in de achtergrond (active: false = user merkt niets).
  // Eerste navigate-actie van de agent navigeert hem naar de juiste URL.
  try {
    const created = await chrome.tabs.create({ url: "about:blank", active: false });
    if (typeof created.id === "number") {
      lastWebTabId = created.id;
      return created.id;
    }
  } catch { /* aanmaken mislukt → noodval hieronder */ }

  // Noodval: tab aanmaken mislukt (bijv. no-permissions edge case) → gebruik bestaande tab.
  // Dit is de enige situatie waarin een user-tab gebruikt mag worden.
  const all = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  if (all.length) {
    all.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    const best = all[0];
    if (typeof best.id === "number") {
      lastWebTabId = best.id;
      return best.id;
    }
  }

  return null;
}

function connect(): void {
  setStatus("verbinden");
  // Downloads gaan meteen volgen, niet pas bij de eerste uitvraag. Een download die
  // begint voordat iemand ernaar vraagt zou anders gemist worden, en juist die volgorde
  // is normaal: de agent klikt eerst en vraagt daarna of er iets binnenkwam.
  volgDownloads();
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
      capabilities: ["dom", "cdp"],
    }),
  );
}

function replyToBrain(
  type: "SNAPSHOT_RESULT" | "ACT_RESULT" | "CONFIRM_RESULT" | "INJECT_COOKIES_RESULT" | "INJECT_LOCALSTORAGE_RESULT" | "NAVIGATE_RESULT" | "SESSION_CAPTURE_DATA" | "SCREENSHOT_RESULT" | "CDP_RESULT" | "ADOPT_TAB_RESULT",
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
      // Stuur direct de UI-instellingen zodat de companion pool bijgewerkt wordt.
      void sendConfigUpdate();
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
      const p = raw.payload as { status?: string; step?: number; message?: string; summary?: string };
      toSidepanel({ type: "YAD_RUN_UPDATE", ...(raw.payload as object) });
      if (p.status && ["klaar", "fout", "gestopt", "geweigerd"].includes(p.status)) {
        endRun();
      }
      break;
    }
    case "COMPANION_CONFIG": {
      const p = raw.payload as { activeProviders: string[]; encKeys?: Record<string, string> };
      toSidepanel({ type: "YAD_COMPANION_CONFIG", activeProviders: p.activeProviders });
      // De companion stuurde versleutelde blobs terug voor sleutels die nu nog plat
      // opgeslagen staan: vervang de platte sleutel door de blob, nooit andersom.
      // Zo bewaart de extensie na de eerste keer nooit meer een leesbare API-sleutel.
      if (p.encKeys && Object.keys(p.encKeys).length > 0) void upgradeToEncrypted(p.encKeys);
      break;
    }
    case "SESSION_RESULT": {
      const p = raw.payload as { ok: boolean; brand?: string; path?: string; authType?: string; detail?: string };
      toSidepanel({ type: "YAD_SESSION_RESULT", ...p });
      break;
    }
    case "INJECT_COOKIES": {
      const p = raw.payload as { url: string; cookies: Array<{ name: string; value: string }> };
      void injectCookies(p.url, p.cookies).then((count) => {
        replyToBrain("INJECT_COOKIES_RESULT", { ok: true, count }, raw.id);
      }).catch(() => {
        replyToBrain("INJECT_COOKIES_RESULT", { ok: false, count: 0 }, raw.id);
      });
      break;
    }
    case "CLAUDE_BRIDGE_RESULT": {
      const p = raw.payload as { ok: boolean; path?: string; detail?: string };
      toSidepanel({ type: "YAD_CLAUDE_BRIDGE_RESULT", ...p });
      break;
    }
    case "REQUEST_CAPTURE_FOR_CLAUDE": {
      void handleCaptureForClaude();
      break;
    }
    case "REQUEST_SESSION_CAPTURE": {
      const p = raw.payload as { label: "A" | "B" };
      void (async () => {
        try {
          const tab = await getActiveWebTab();
          if (!tab || typeof tab.id !== "number") {
            replyToBrain("SESSION_CAPTURE_DATA", { ok: false, label: p.label, detail: "Geen actieve web-tab" }, raw.id);
            return;
          }
          const captured = await captureSession(tab.id);
          replyToBrain("SESSION_CAPTURE_DATA", { ok: true, label: p.label, ...captured }, raw.id);
        } catch (e) {
          replyToBrain("SESSION_CAPTURE_DATA", { ok: false, label: p.label, detail: (e as Error).message }, raw.id);
        }
      })();
      break;
    }
    case "REQUEST_NAVIGATE": {
      const p = raw.payload as { url: string };
      void (async () => {
        // Navigeer op de run-tab (als die loopt), anders de sticky tab, anders resolve.
        // NIET lastWebTabId als eerste keuze — dat zou de email-tab van de user kunnen zijn.
        let tabId = runTabId ?? stickyTabId;
        if (tabId == null) tabId = await resolveRunTab();
        if (tabId == null) {
          replyToBrain("NAVIGATE_RESULT", { ok: false, detail: "geen actieve tab" }, raw.id);
          return;
        }
        try {
          await chrome.tabs.update(tabId, { url: p.url });
          const done = await waitForLoad(tabId);
          replyToBrain("NAVIGATE_RESULT", { ok: done }, raw.id);
        } catch (e) {
          replyToBrain("NAVIGATE_RESULT", { ok: false, detail: (e as Error).message }, raw.id);
        }
      })();
      break;
    }
    case "REQUEST_ADOPT_TAB": {
      const p = raw.payload as { pattern: string };
      void (async () => {
        try {
          const tabs = await chrome.tabs.query({});
          const match = tabs.find(
            (t) => typeof t.url === "string" && t.url.includes(p.pattern) && typeof t.id === "number"
          );
          if (!match || typeof match.id !== "number") {
            replyToBrain("ADOPT_TAB_RESULT", { ok: false, detail: `geen open tab gevonden met '${p.pattern}' in de URL` }, raw.id);
            return;
          }
          stickyTabId = match.id;
          // Ook hier het dialoogvangnet leggen: adopteren is vaak de eerste handeling,
          // en daarna kan er meteen een actie komen die een confirm() opent.
          void zorgVoorDialoogVangnet(match.id);
          runTabId = match.id;
          await chrome.tabs.update(match.id, { active: true });
          replyToBrain("ADOPT_TAB_RESULT", { ok: true, tabId: match.id, url: match.url }, raw.id);
        } catch (e) {
          replyToBrain("ADOPT_TAB_RESULT", { ok: false, detail: (e as Error).message }, raw.id);
        }
      })();
      break;
    }
    case "INJECT_LOCALSTORAGE": {
      const p = raw.payload as { items: Record<string, string> };
      const tabId = runTabId ?? lastWebTabId;
      if (tabId == null) {
        replyToBrain("INJECT_LOCALSTORAGE_RESULT", { ok: false, count: 0 }, raw.id);
        break;
      }
      void injectLocalStorage(tabId, p.items).then((count) => {
        replyToBrain("INJECT_LOCALSTORAGE_RESULT", { ok: true, count }, raw.id);
      }).catch(() => {
        replyToBrain("INJECT_LOCALSTORAGE_RESULT", { ok: false, count: 0 }, raw.id);
      });
      break;
    }
    case "REQUEST_SCREENSHOT": {
      void (async () => {
        const tabId = runTabId ?? lastWebTabId;
        try {
          if (tabId == null) throw new Error("geen run-tab");
          const tab = await chrome.tabs.get(tabId);
          // captureVisibleTab werkt alleen in het window van de tab.
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
          replyToBrain("SCREENSHOT_RESULT", { ok: true, dataUrl }, raw.id);
        } catch (e) {
          replyToBrain("SCREENSHOT_RESULT", { ok: false, detail: (e as Error).message }, raw.id);
        }
      })();
      break;
    }
    case "CDP_COMMAND": {
      const p = raw.payload as {
        command: string;
        tabId?: number;
        urlFilter?: string;
        expression?: string;
        requestId?: string;
        responseBody?: string;
        modifiedHeaders?: Array<{ name: string; value: string }>;
        block?: boolean;
        cookies?: Array<{ name: string; value: string; domain?: string; path?: string }>;
        cookieUrl?: string;
        keepUrlContains?: string;
        /** Alleen downloads van ná dit tijdstip (ms), voor list_downloads. */
        sinds?: number;
      };
      void (async () => {
        // Deze twee commando's werken op de hele browser/extensie, niet op één specifieke tab —
        // apart afgehandeld VOORDAT de tab-vereiste guard hieronder draait, zodat die guard voor
        // alle overige (wél tab-specifieke) commando's exact zo simpel blijft als hij was.
        if (p.command === "close_other_tabs") {
          if (!p.keepUrlContains) {
            replyToBrain("CDP_RESULT", { ok: false, command: "close_other_tabs", detail: "keepUrlContains ontbreekt" }, raw.id);
            return;
          }
          const keep = p.keepUrlContains;
          try {
            const allTabs = await chrome.tabs.query({});
            const toClose = allTabs.filter((t) => !(t.url ?? t.pendingUrl ?? "").includes(keep));
            let closed = 0;
            for (const t of toClose) {
              if (t.id == null) continue;
              try {
                await chrome.tabs.remove(t.id);
                closed++;
              } catch {
                // tab kan intussen al door de gebruiker zelf gesloten zijn — negeren, geen halt
              }
            }
            replyToBrain("CDP_RESULT", {
              ok: true,
              command: "close_other_tabs",
              closed,
              kept: allTabs.length - toClose.length,
              totalBefore: allTabs.length,
            }, raw.id);
          } catch (e) {
            replyToBrain("CDP_RESULT", { ok: false, command: "close_other_tabs", detail: (e as Error).message }, raw.id);
          }
          return;
        }
        if (p.command === "reload_extension") {
          // Antwoord EERST, want chrome.runtime.reload() breekt deze native-port-verbinding
          // meteen af (de extensie herstart zichzelf) — na dit punt komt er geen antwoord meer
          // door. Chrome herstelt de native-messaging-verbinding vanzelf zodra de herladen
          // extensie weer een verbinding opent.
          replyToBrain("CDP_RESULT", { ok: true, command: "reload_extension", detail: "extensie herlaadt nu" }, raw.id);
          setTimeout(() => chrome.runtime.reload(), 150);
          return;
        }

        // Downloads zijn browserbreed en hebben geen tab nodig. Dit vóór de tab-eis
        // afhandelen, want anders krijg je "geen actieve tab" op een vraag die niets met
        // een tab te maken heeft. Dat is precies het soort misleidende foutmelding waar
        // je een half uur naar zit te kijken.
        if (p.command === "list_downloads") {
          const sinds = typeof p.sinds === "number" ? p.sinds : undefined;
          const lijst = await getKlaarDownloads(sinds);
          replyToBrain("CDP_RESULT", { ok: true, command: "list_downloads", downloads: lijst }, raw.id);
          return;
        }

        // Bepaal de doeltab: expliciet opgegeven, anders run-tab of laatste web-tab.
        const tabId = p.tabId ?? runTabId ?? lastWebTabId;
        if (tabId == null) {
          replyToBrain("CDP_RESULT", { ok: false, command: p.command, detail: "geen actieve tab" }, raw.id);
          return;
        }
        try {
          switch (p.command) {
            case "start_capture": {
              await startCapture(tabId, p.urlFilter);
              replyToBrain("CDP_RESULT", { ok: true, command: "start_capture" }, raw.id);
              break;
            }
            case "stop_capture": {
              const { requests, consoleEntries, webSocketFrames } = await stopCapture();
              replyToBrain("CDP_RESULT", { ok: true, command: "stop_capture", requests, consoleEntries, webSocketFrames }, raw.id);
              break;
            }
            case "evaluate": {
              if (!p.expression) {
                replyToBrain("CDP_RESULT", { ok: false, command: "evaluate", detail: "expression ontbreekt" }, raw.id);
                break;
              }
              const res = await evaluateInPage(tabId, p.expression);
              replyToBrain("CDP_RESULT", {
                ok: !res.error,
                command: "evaluate",
                value: res.value,
                valueType: res.valueType,
                ...(res.error ? { detail: res.error } : {}),
              }, raw.id);
              break;
            }
            case "get_response_body": {
              if (!p.requestId) {
                replyToBrain("CDP_RESULT", { ok: false, command: "get_response_body", detail: "requestId ontbreekt" }, raw.id);
                break;
              }
              const bodyRes = await getResponseBody(tabId, p.requestId);
              replyToBrain("CDP_RESULT", {
                ok: true,
                command: "get_response_body",
                body: bodyRes.body,
                base64Encoded: bodyRes.base64Encoded,
              }, raw.id);
              break;
            }
            case "intercept_enable": {
              await enableIntercept(tabId, p.urlFilter, (intercepted) => {
                // Stuur het onderschepte request direct naar de companion als CDP_RESULT
                replyToBrain("CDP_RESULT", { ok: true, command: "intercept_enable", intercepted }, raw.id);
              });
              // Bevestig dat intercept actief is (het echte antwoord komt later via de callback)
              replyToBrain("CDP_RESULT", { ok: true, command: "intercept_enable" }, raw.id);
              break;
            }
            case "intercept_disable": {
              await disableIntercept();
              replyToBrain("CDP_RESULT", { ok: true, command: "intercept_disable" }, raw.id);
              break;
            }
            case "intercept_continue": {
              if (!p.requestId) {
                replyToBrain("CDP_RESULT", { ok: false, command: "intercept_continue", detail: "requestId ontbreekt" }, raw.id);
                break;
              }
              const done = continueIntercept(
                p.requestId,
                p.block ? "block" : "continue",
                p.responseBody !== undefined
                  ? { body: p.responseBody, responseHeaders: p.modifiedHeaders }
                  : p.modifiedHeaders ? { requestHeaders: p.modifiedHeaders } : undefined,
              );
              replyToBrain("CDP_RESULT", {
                ok: done,
                command: "intercept_continue",
                detail: done ? undefined : `request ${p.requestId} niet gevonden in wachtrij`,
              }, raw.id);
              break;
            }
            case "peek_network_requests": {
              const entries = peekNetworkRequests(p.urlFilter);
              replyToBrain("CDP_RESULT", { ok: true, command: "peek_network_requests", requests: entries }, raw.id);
              break;
            }
            case "get_cookies": {
              const cookies = await getCookies(tabId);
              replyToBrain("CDP_RESULT", { ok: true, command: "get_cookies", cookies }, raw.id);
              break;
            }
            case "set_cookies": {
              if (!p.cookies?.length) {
                replyToBrain("CDP_RESULT", { ok: false, command: "set_cookies", detail: "cookies array is leeg of ontbreekt" }, raw.id);
                break;
              }
              await setCookies(tabId, p.cookies, p.cookieUrl);
              replyToBrain("CDP_RESULT", { ok: true, command: "set_cookies" }, raw.id);
              break;
            }
            default:
              replyToBrain("CDP_RESULT", { ok: false, command: p.command, detail: `onbekend commando: ${p.command}` }, raw.id);
          }
        } catch (e) {
          replyToBrain("CDP_RESULT", { ok: false, command: p.command, detail: (e as Error).message }, raw.id);
        }
      })();
      break;
    }
    default:
      break;
  }
}

/**
 * Vervangt platte sleutels in chrome.storage door de DPAPI-blob die de companion terugstuurde,
 * en zet encrypted:true. Zo staat er ná de eerste ronde geen leesbare API-sleutel meer lokaal.
 */
async function upgradeToEncrypted(encKeys: Record<string, string>): Promise<void> {
  const settings = await getSettings();
  let changed = false;
  for (const [envName, blob] of Object.entries(encKeys)) {
    const providerId = ENV_KEY_TO_PROVIDER[envName];
    const cfg = providerId ? settings.providers[providerId] : undefined;
    if (cfg && !cfg.encrypted && blob) {
      settings.providers[providerId] = { ...cfg, key: blob, encrypted: true };
      changed = true;
    }
  }
  if (changed) await saveSettings(settings);
}

/** Leest UI-instellingen en stuurt ze als UPDATE_CONFIG naar de companion. */
async function sendConfigUpdate(): Promise<void> {
  if (!port) return;
  const settings = await getSettings();
  uiLang = settings.language === "en" ? "en" : "nl";
  const { env, encEnv } = settingsToEnv(settings);
  port.postMessage(
    handMessage("UPDATE_CONFIG", {
      env,
      encEnv,
      maxSteps: settings.maxSteps,
      autonomy: settings.autonomy,
      language: settings.language,
      maxRequestsPerDay: settings.maxRequestsPerDay,
      killed: settings.killed,
    }),
  );
}

async function handleCaptureForClaude(): Promise<void> {
  await refreshUiLang();
  if (!port) {
    toSidepanel({ type: "YAD_CLAUDE_BRIDGE_RESULT", ok: false, detail: rt("notConnected") });
    return;
  }
  toSidepanel({ type: "YAD_CLAUDE_BRIDGE_CAPTURING" });
  try {
    // Prefer de YAD-werktab (stickyTabId) boven de meest-recent-bezochte tab.
    // Zo pakt capture altijd de tab waar YAD het doel uitvoerde, ook als de gebruiker
    // ondertussen een andere tab actief heeft (bv. DuckDNS tijdens x402scan-registratie).
    let tab: chrome.tabs.Tab | undefined;
    if (stickyTabId != null) {
      try {
        const known = await chrome.tabs.get(stickyTabId);
        if (known.url && /^https?:\/\//i.test(known.url)) tab = known;
      } catch { /* tab gesloten — val terug op query */ }
    }
    if (!tab) {
      const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
      tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
      tab = tabs[0];
    }
    if (!tab || typeof tab.id !== "number") {
      toSidepanel({ type: "YAD_CLAUDE_BRIDGE_RESULT", ok: false, detail: rt("noWebTab") });
      return;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const text = (document.body?.innerText ?? "").slice(0, 20000);
        const links = Array.from(document.querySelectorAll("a[href]"))
          .map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? "").trim() }))
          .filter((l) => l.href.startsWith("http") && l.text.length > 0)
          .slice(0, 100);
        return { text, links };
      },
    });
    const result = results[0]?.result as { text: string; links: Array<{ href: string; text: string }> } | undefined;
    const text = result?.text ?? "";
    const links = result?.links ?? [];
    port.postMessage(handMessage("PAGE_CAPTURE", {
      url: tab.url ?? "",
      title: tab.title ?? "",
      text,
      links,
      capturedAt: new Date().toISOString(),
    }));
  } catch (e) {
    toSidepanel({ type: "YAD_CLAUDE_BRIDGE_RESULT", ok: false, detail: (e as Error).message });
  }
}

async function handleCaptureSession(label: "A" | "B"): Promise<void> {
  await refreshUiLang();
  if (!port) {
    toSidepanel({ type: "YAD_SESSION_RESULT", ok: false, detail: rt("notConnected") });
    return;
  }
  toSidepanel({ type: "YAD_SESSION_CAPTURING", label });
  try {
    const tab = await getActiveWebTab();
    if (!tab || typeof tab.id !== "number") {
      toSidepanel({ type: "YAD_SESSION_RESULT", ok: false, detail: rt("noWebTabSession") });
      return;
    }
    const captured = await captureSession(tab.id);
    port.postMessage(handMessage("SESSION_CAPTURE", { ...captured, label }));
  } catch (e) {
    toSidepanel({ type: "YAD_SESSION_RESULT", ok: false, detail: (e as Error).message });
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
  // HTTP API-pad: companion startte direct zonder GOAL via extensie → runTabId niet gezet.
  // Adopteer de best beschikbare tab zodat synchrone /goal-runs werken.
  if (runTabId == null) {
    const adopted = await resolveRunTab();
    if (adopted == null) {
      replyToBrain("SNAPSHOT_RESULT", { snapshot: errorSnapshot("geen actieve tab") }, corr);
      return;
    }
    runTabId = adopted;
    runInProgress = true;
  }
  // Niet-inspecteerbare pagina (about:blank, chrome://, verse tab): geef een schone
  // LEGE snapshot i.p.v. een fout, zodat het model gewoon kan navigeren.
  try {
    const tab = await chrome.tabs.get(runTabId);
    if (!tab.url || !/^https?:\/\//i.test(tab.url)) {
      replyToBrain(
        "SNAPSHOT_RESULT",
        {
          snapshot: {
            url: tab.url ?? "",
            title: tab.title ?? "",
            nodes: [],
            textDigest: "(lege pagina — er is nog niet genavigeerd)",
          },
        },
        corr,
      );
      return;
    }
  } catch {
    replyToBrain("SNAPSHOT_RESULT", { snapshot: errorSnapshot("tab verdween") }, corr);
    return;
  }
  try {
    await ensureContentScript(runTabId);
    const snapshot = await snapshotAlleFrames(runTabId);
    // Verrijk de snapshot met een eventuele site-override van de gebruiker.
    const enriched = await augmentSnapshot(snapshot);
    replyToBrain("SNAPSHOT_RESULT", { snapshot: enriched }, corr);
  } catch (e) {
    replyToBrain(
      "SNAPSHOT_RESULT",
      { snapshot: errorSnapshot(`pagina onbereikbaar: ${(e as Error).message}`) },
      corr,
    );
  }
}

/**
 * Scheidingsteken tussen frame-id en element-ref: `f3:e7` is element e7 in frame 3.
 *
 * Het hoofdframe houdt bewust zijn kale refs (`e7`). Zo verandert er niets aan het
 * gedrag op de overgrote meerderheid van pagina's, die helemaal geen frames hebben, en
 * blijven bestaande caches en logregels leesbaar.
 */
const FRAME_SCHEIDING = ":";

/** Splitst `f3:e7` in frame 3 en ref e7. Zonder voorvoegsel: hoofdframe. */
function ontleedRef(ref: string): { frameId: number; ref: string } {
  const m = /^f(\d+):(.+)$/.exec(ref);
  return m ? { frameId: Number(m[1]), ref: m[2]! } : { frameId: 0, ref };
}

/**
 * Haalt een snapshot op uit ALLE frames van de tab en voegt ze samen.
 *
 * WAAROM: het content-script draaide alleen in het hoofdframe, en perception haalt
 * same-origin iframes binnen via contentDocument. Bij een cross-origin frame gooit dat
 * een SecurityError en blijft de inhoud onzichtbaar. Juist daar zitten de dingen die er
 * toe doen: betaalformulieren, ingesloten logins, chatwidgets. Met `allFrames: true`
 * draait ons script ín dat frame en heeft het dat probleem niet.
 *
 * Frames die niet antwoorden worden stil overgeslagen. Dat is bewust: een advertentie-
 * frame zonder ons script mag nooit de hele waarneming laten mislukken.
 */
async function snapshotAlleFrames(tabId: number): Promise<Snapshot> {
  const hoofd = (await chrome.tabs.sendMessage(tabId, { type: "YAD_SNAPSHOT" }, { frameId: 0 })) as Snapshot;

  let frames: chrome.webNavigation.GetAllFrameResultDetails[] | undefined;
  try {
    frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? undefined;
  } catch {
    return hoofd; // geen frame-informatie: hoofdframe is dan alles wat we hebben
  }
  const subs = (frames ?? []).filter((f) => f.frameId !== 0 && /^https?:/.test(f.url));
  if (subs.length === 0) return hoofd;

  // Plafond op 8 frames: pagina's met tientallen advertentie-frames zouden anders elke
  // waarneming traag maken, terwijl die frames zelden het doel van de taak zijn.
  const nodes = [...hoofd.nodes];
  const stukjes: string[] = [];
  for (const f of subs.slice(0, 8)) {
    try {
      const s = (await chrome.tabs.sendMessage(tabId, { type: "YAD_SNAPSHOT" }, { frameId: f.frameId })) as Snapshot;
      if (!s?.nodes?.length) continue;
      for (const n of s.nodes) nodes.push({ ...n, ref: `f${f.frameId}${FRAME_SCHEIDING}${n.ref}` });
      if (s.textDigest) stukjes.push(s.textDigest);
    } catch {
      /* frame zonder ons script of al weg — overslaan, nooit de hele snapshot laten vallen */
    }
  }

  return {
    ...hoofd,
    nodes,
    // De tekst van de frames erachter plakken zodat het brein weet wat erin staat.
    textDigest: stukjes.length ? `${hoofd.textDigest}\n${stukjes.join("\n")}` : hoofd.textDigest,
  };
}

/** Voegt siteProfileOverride toe als de gebruiker een override heeft ingesteld. */
async function augmentSnapshot(snapshot: Snapshot): Promise<Snapshot> {
  try {
    const overrides = await getSiteOverrides();
    const hostname = new URL(snapshot.url).hostname.replace(/^www\./, "").toLowerCase();
    const tier = overrides[hostname];
    if (tier) return { ...snapshot, siteProfileOverride: tier };
  } catch {
    /* ongeldige URL of storage-fout → snapshot ongewijzigd */
  }
  return snapshot;
}

async function handleAct(corr: string, action: Action): Promise<void> {
  // Zelfde HTTP API-adoptie als handleSnapshot.
  if (runTabId == null) {
    const adopted = await resolveRunTab();
    if (adopted == null) {
      replyToBrain("ACT_RESULT", { ok: false, detail: "geen actieve tab" }, corr);
      return;
    }
    runTabId = adopted;
    runInProgress = true;
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
    // Draagt de ref een frame-voorvoegsel (`f3:e7`), dan hoort de actie in dát frame
    // thuis. Zonder deze routering zou een klik op een veld in een betaal-iframe naar
    // het hoofdframe gaan, daar geen element met die ref vinden, en falen met een
    // melding die nergens naar wijst.
    const refInAction = (action as { ref?: string }).ref;
    if (typeof refInAction === "string" && refInAction.includes(FRAME_SCHEIDING)) {
      const { frameId, ref } = ontleedRef(refInAction);
      const inFrame = { ...(action as object), ref } as typeof action;
      const r = await chrome.tabs.sendMessage(runTabId, { type: "YAD_ACT", action: inFrame }, { frameId });
      replyToBrain("ACT_RESULT", r as object, corr);
      return;
    }
    const result = await chrome.tabs.sendMessage(runTabId, { type: "YAD_ACT", action }, { frameId: 0 });
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
