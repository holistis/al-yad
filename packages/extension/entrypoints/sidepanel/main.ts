import {
  ACCEPT_ITEMS,
  ACCEPT_SUMMARY,
  isAccepted,
  recordAcceptance,
} from "../../lib/acceptance";
import {
  getSettings,
  saveSettings,
  getWorkflows,
  addWorkflow,
  deleteWorkflow,
  getHistory,
  addHistoryEntry,
  getSiteOverrides,
  setSiteOverride,
} from "../../lib/storage";
import { PROVIDER_CATALOG, type ProviderCatalogEntry } from "../../lib/providers";
import type { YadSettings, YadHistoryEntry, ProviderUserConfig } from "@yad/shared";

type RunStatus = "plannen" | "bezig" | "klaar" | "gestopt" | "fout" | "geweigerd";

interface PendingAttachment {
  mimeType: string;
  data: string;
  name: string;
  previewUrl: string;
}

// ---- i18n ----

const STRINGS = {
  nl: {
    tabTask: "Taak", tabSaved: "Opgeslagen", tabSettings: "Instellingen", tabStats: "Stats",
    brandSub: "de hand · jouw AI browser-agent",
    connConnected: "Verbonden", connConnecting: "Verbinden…", connDisconnected: "Niet verbonden",
    placeholder: "Wat moet ik doen? (bv. zoek 5 vacatures op LinkedIn)",
    pasteHint: "Of plak een afbeelding (Ctrl+V)",
    copyBtn: "Kopieer", copiedBtn: "Gekopieerd ✓",
    confirmYes: "Goedkeuren", confirmNo: "Weigeren",
    savePrompt: "Taak geslaagd — bewaar als snelkoppeling?",
    saveNamePh: "Naam (bv. LinkedIn vacatures)", saveOk: "Bewaar", saveSkip: "Overslaan",
    savedTasks: "Opgeslagen taken", historyTitle: "Geschiedenis",
    noSavedTasks: "Nog geen taken bewaard.\nStart een taak en bewaar hem als hij klaar is.",
    noHistory: "Nog geen runs.",
    settingsProviders: "AI-providers",
    providerSearch: "Zoek een AI-aanbieder (Groq, Gemini, Mistral…)",
    providerHint: "Vink een provider aan, plak je sleutel. Staat jouw aanbieder er niet bij? Gebruik ‘Eigen / andere provider’.",
    settingsBehavior: "Gedrag",
    maxStepsLabel: "Max stappen per taak:",
    autonomyLabel: "Hoe zelfstandig mag Yad werken?",
    confirmMode: "🛡️ Vraag bevestiging",
    confirmModeDesc: "Yad vraagt jou bij elke wijziging (veilig, standaard)",
    autoMode: "⚡ Volledig zelfstandig",
    autoModeDesc: "Yad doet alles zelf, zonder te vragen",
    autonomyHint: "Betaal- en bestelpagina’s (/checkout, /payment) blijven altijd geblokkeerd, ook zelfstandig.",
    languageLabel: "Taal van de antwoorden",
    langNl: "🇳🇱 Nederlands", langEn: "🇬🇧 English",
    langHint: "Kies de taal waarin Yad zijn antwoorden schrijft.",
    tierCautious: "Voorzichtig", tierNormal: "Normaal", tierFast: "Snel", tierDefault: "Standaard",
    tierHint: "Voorzichtig = mensachtig tempo (LinkedIn). Snel = minimale pauze (eigen tools). Standaard = automatisch.",
    saveSettings: "Opslaan & toepassen", savedMsg: "Opgeslagen en toegepast.",
    statsTitle: "Lokale statistieken", noStats: "Nog geen runs om te analyseren.",
    statsRuns: "Runs", statsSucceeded: "Geslaagd", statsAvgSteps: "Gem. stappen", statsFailed: "Mislukt",
    statsSuccessRate: "Slaagkans", statsTopTasks: "Meest gebruikte taken",
    statsPrivacy: "Alle gegevens staan alleen op jouw apparaat. Er wordt niets verzonden.",
    domainLabel: "Huidig domein:",
    sessionCaptureTitle: "Sessies (REDACTED)",
    sessionCaptureHint: "Log in op een REDACTED site in de actieve tab. Klik dan om de sessie vast te leggen zodat de pentest-suite hem kan gebruiken.",
    captureA: "📸 Account A",
    captureB: "📸 Account B",
    capturingMsg: "Sessie vastleggen…",
    claudeBridgeTitle: "Claude-brug",
    claudeBridgeHint: "Stuur de huidige pagina naar Claude Code. Claude leest hem direct via C:\\Code\\yad-claude-bridge.json.",
    claudeCaptureBtn: "🔗 Stuur naar Claude",
    claudeCapturingMsg: "Pagina sturen…",
    welcomeTitle: "Hallo, ik ben Yad. Je eigen hand in de browser.",
    welcomeWhat: "Je zegt in gewone taal wat je wilt, en ik klik en typ het voor je op elke website. In jouw eigen browser, waar je al bent ingelogd. Ik leer een klus één keer en kan hem daarna zo herhalen.",
    welcomeCanTitle: "Wat je me kunt vragen",
    welcomeCan1: "Iets opzoeken en netjes op een rij zetten",
    welcomeCan2: "Saaie stappen herhalen die je steeds opnieuw doet",
    welcomeCan3: "Lezen wat er op een pagina staat en het teruggeven",
    welcomeTryTitle: "Probeer bijvoorbeeld",
    welcomeEx1: "Zoek 5 vacatures en zet ze op een rij",
    welcomeEx2: "Vat deze pagina kort voor me samen",
    welcomeEx3: "Verzamel de prijzen van de producten op deze pagina",
    welcomePrivacy: "Je wachtwoorden blijven op je computer, en jij kiest welke AI je gebruikt.",
    welcomeHint: "Typ hieronder wat ik moet doen, of klik een voorbeeld.",
    bizTitle: "Voor je bedrijf?",
    bizText: "YAD draait op je eigen computer. Wil je hem afgestemd op je team, of volledig op je eigen servers zodat je data binnen blijft?",
    bizCta: "Neem contact op",
    provKeyLabel: "API-sleutel",
    provModelLabel: "Model (leeg = standaard)",
    provModelPh: "bv.",
    provPrimaryLabel: "Dit model als sterkste EERST gebruiken",
    provSignup: "Aanmelden →",
    provShow: "Toon", provHide: "Verberg",
    provCompanionActive: "✓ actief",
    provCompanionActiveTitle: "Actief in companion via .env, geen sleutel nodig in de UI",
    provNoResults: "Geen aanbieder gevonden.",
    spendTitle: "Uitgaven en veiligheid",
    spendCapLabel: "Max AI-aanroepen per dag:",
    spendCapHint: "Een veiligheidsplafond zodat Yad nooit ongelimiteerd je sleutel kan blijven gebruiken.",
    killStart: "Stop Yad nu",
    killStop: "Yad is gestopt. Weer inschakelen",
    killHint: "Blokkeert direct elke AI-aanroep tot je hem weer aanzet.",
    scanBtn: "Bekijk wat Yad op deze pagina ziet",
    qbConfirm: "Bevestig", qbAuto: "Auto",
    attachBtn: "📎 Upload bijlage",
    attachBtnTitle: "Bijlage uploaden (afbeelding, .txt, .rtf)",
    startTitle: "Taak starten",
    attachUnreadable: "niet leesbaar. Exporteer je CV als .txt (Word, Opslaan als, Tekst).",
    confirmFallback: "Bevestig deze actie",
    statsTotal: "totaal", statsAborted: "of afgebroken", statsPerRun: "per run",
    scanLooking: "Bezig met kijken…",
    scanOnlyWebpage: "Dit werkt alleen op een gewone webpagina. Ga eerst naar een site.",
    scanNoElements: "Geen bedienbare elementen gevonden. Dat gebeurt op pagina's die alles in een afgeschermd kader laden.",
    scanNoLabel: "(zonder opschrift)",
    scanRecognized: "elementen herkend.",
    scanRecognizedFirst60: "elementen herkend, de eerste 60 staan hieronder.",
    scanReadError: "Kon de pagina niet lezen: ",
    bridgeSent: "Pagina verstuurd",
    unknownError: "Onbekende fout",
    sessionFallbackName: "Sessie",
    sessionCaptured: "account vastgelegd",
    cvContextPrefix: "CONTEXT, mijn CV",
    cvDefaultGoal: "Zoek vacatures die bij dit CV passen op jobs.be, Indeed.be of LinkedIn. Geef de top 5 met functietitel, bedrijf en link.",
    gateTitle: "Voor je begint",
    gateDocTerms: "Algemene Voorwaarden",
    gateDocPrivacy: "Privacyverklaring",
    gateDocAup: "Gebruiksbeleid",
    gateAccept: "Akkoord en starten",
    gateConcept: "Dit is een concept.",
    removeTitle: "Verwijder", closeTitle: "Sluiten",
  },
  en: {
    tabTask: "Task", tabSaved: "Saved", tabSettings: "Settings", tabStats: "Stats",
    brandSub: "the hand · your AI browser agent",
    connConnected: "Connected", connConnecting: "Connecting…", connDisconnected: "Not connected",
    placeholder: "What should I do? (e.g. find 5 jobs on LinkedIn)",
    pasteHint: "Or paste an image (Ctrl+V)",
    copyBtn: "Copy", copiedBtn: "Copied ✓",
    confirmYes: "Approve", confirmNo: "Reject",
    savePrompt: "Task completed — save as shortcut?",
    saveNamePh: "Name (e.g. LinkedIn jobs)", saveOk: "Save", saveSkip: "Skip",
    savedTasks: "Saved tasks", historyTitle: "History",
    noSavedTasks: "No tasks saved yet.\nStart a task and save it when done.",
    noHistory: "No runs yet.",
    settingsProviders: "AI providers",
    providerSearch: "Search an AI provider (Groq, Gemini, Mistral…)",
    providerHint: "Check a provider and paste your key. Not listed? Use ‘Custom / other provider’.",
    settingsBehavior: "Behavior",
    maxStepsLabel: "Max steps per task:",
    autonomyLabel: "How independent should Yad be?",
    confirmMode: "🛡️ Ask confirmation",
    confirmModeDesc: "Yad asks you before every change (safe, default)",
    autoMode: "⚡ Fully autonomous",
    autoModeDesc: "Yad does everything itself, without asking",
    autonomyHint: "Payment and order pages (/checkout, /payment) are always blocked, even in auto mode.",
    languageLabel: "Language of answers",
    langNl: "🇳🇱 Nederlands", langEn: "🇬🇧 English",
    langHint: "Choose the language Yad writes its answers in.",
    tierCautious: "Cautious", tierNormal: "Normal", tierFast: "Fast", tierDefault: "Default",
    tierHint: "Cautious = human-like pacing (LinkedIn). Fast = minimal delay (own tools). Default = automatic.",
    saveSettings: "Save & apply", savedMsg: "Saved and applied.",
    statsTitle: "Local statistics", noStats: "No runs to analyze yet.",
    statsRuns: "Runs", statsSucceeded: "Succeeded", statsAvgSteps: "Avg. steps", statsFailed: "Failed",
    statsSuccessRate: "Success rate", statsTopTasks: "Most used tasks",
    statsPrivacy: "All data stays on your device only. Nothing is sent.",
    domainLabel: "Current domain:",
    sessionCaptureTitle: "Sessions (REDACTED)",
    sessionCaptureHint: "Log in to an REDACTED site in the active tab, then click to capture the session so the pentest suite can use it.",
    captureA: "📸 Account A",
    captureB: "📸 Account B",
    capturingMsg: "Capturing session…",
    claudeBridgeTitle: "Claude bridge",
    claudeBridgeHint: "Send the current page to Claude Code. Claude reads it directly from C:\\Code\\yad-claude-bridge.json.",
    claudeCaptureBtn: "🔗 Send to Claude",
    claudeCapturingMsg: "Sending page…",
    welcomeTitle: "Hi, I am Yad. Your own hand in the browser.",
    welcomeWhat: "Tell me in plain words what you want, and I click and type it for you on any website. Inside your own browser, where you are already logged in. I learn a job once and can repeat it after that.",
    welcomeCanTitle: "What you can ask me",
    welcomeCan1: "Look something up and put it in a neat list",
    welcomeCan2: "Repeat boring steps you do again and again",
    welcomeCan3: "Read what is on a page and hand it back to you",
    welcomeTryTitle: "Try for example",
    welcomeEx1: "Find 5 job posts and list them",
    welcomeEx2: "Give me a short summary of this page",
    welcomeEx3: "Collect the prices of the products on this page",
    welcomePrivacy: "Your passwords stay on your computer, and you choose which AI to use.",
    welcomeHint: "Type what I should do below, or click an example.",
    bizTitle: "For your company?",
    bizText: "YAD runs on your own computer. Want it tuned to your team, or fully on your own servers so your data stays in?",
    bizCta: "Get in touch",
    provKeyLabel: "API key",
    provModelLabel: "Model (empty = default)",
    provModelPh: "e.g.",
    provPrimaryLabel: "Use this model FIRST, as the strongest",
    provSignup: "Sign up →",
    provShow: "Show", provHide: "Hide",
    provCompanionActive: "✓ active",
    provCompanionActiveTitle: "Active in the companion via .env, no key needed in the UI",
    provNoResults: "No provider found.",
    spendTitle: "Spending and safety",
    spendCapLabel: "Max AI calls per day:",
    spendCapHint: "A safety ceiling so Yad can never keep using your key without limit.",
    killStart: "Stop Yad now",
    killStop: "Yad is stopped. Resume",
    killHint: "Instantly blocks every AI call until you turn it back on.",
    scanBtn: "See what Yad detects on this page",
    qbConfirm: "Confirm", qbAuto: "Auto",
    attachBtn: "📎 Upload attachment",
    attachBtnTitle: "Upload attachment (image, .txt, .rtf)",
    startTitle: "Start task",
    attachUnreadable: "not readable. Export your CV as .txt (Word, Save as, Text).",
    confirmFallback: "Confirm this action",
    statsTotal: "total", statsAborted: "or aborted", statsPerRun: "per run",
    scanLooking: "Looking…",
    scanOnlyWebpage: "This only works on a normal web page. Go to a site first.",
    scanNoElements: "No usable elements found. This happens on pages that load everything inside a shielded frame.",
    scanNoLabel: "(no label)",
    scanRecognized: "elements recognized.",
    scanRecognizedFirst60: "elements recognized, the first 60 are shown below.",
    scanReadError: "Could not read the page: ",
    bridgeSent: "Page sent",
    unknownError: "Unknown error",
    sessionFallbackName: "Session",
    sessionCaptured: "account captured",
    cvContextPrefix: "CONTEXT, my CV",
    cvDefaultGoal: "Find jobs that match this CV on Indeed, LinkedIn or a local job board. Give the top 5 with job title, company and link.",
    gateTitle: "Before you begin",
    gateDocTerms: "Terms and Conditions",
    gateDocPrivacy: "Privacy Statement",
    gateDocAup: "Acceptable Use Policy",
    gateAccept: "Agree and start",
    gateConcept: "This is a draft.",
    removeTitle: "Remove", closeTitle: "Close",
  },
} as const;

type Lang = "nl" | "en";
type TKey = keyof typeof STRINGS.nl;

let currentLanguage: Lang = "nl";
let currentAutonomy: "confirm" | "auto" = "confirm";
let currentKilled = false;
/** Laatst geladen instellingen, om een leeg-gelaten sleutelveld te kunnen onderscheiden
 * van "gebruiker wil hem wissen" vs "hier stond al een versleutelde blob, niet aanraken". */
let lastLoadedSettings: YadSettings | null = null;
let currentSiteDomain = "";
let companionActiveProviders: string[] = [];

function t(k: TKey): string { return STRINGS[currentLanguage][k]; }
/** Kiest de tekst in de huidige taal voor een tweetalig veld (bv. provider-catalogus). */
function loc(v: { nl: string; en: string }): string { return v[currentLanguage]; }
/** Toont de noodstop-knop in de juiste stand: rood = stoppen, groen = weer inschakelen. */
function renderKillBtn(): void {
  const btn = document.getElementById("kill-toggle");
  if (!btn) return;
  btn.textContent = currentKilled ? t("killStop") : t("killStart");
  (btn as HTMLElement).style.background = currentKilled ? "#16a34a" : "#dc2626";
}

function applyLang(): void {
  document.documentElement.lang = currentLanguage;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const k = el.dataset["i18n"] as TKey | undefined;
    if (k && k in STRINGS[currentLanguage]) el.textContent = t(k);
  });
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-i18n-ph]").forEach((el) => {
    const k = el.dataset["i18nPh"] as TKey | undefined;
    if (k && k in STRINGS[currentLanguage]) el.placeholder = t(k);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const k = el.dataset["i18nTitle"] as TKey | undefined;
    if (k && k in STRINGS[currentLanguage]) el.title = t(k);
  });
  const domLbl = document.getElementById("site-domain-label");
  if (domLbl) {
    domLbl.textContent = currentSiteDomain
      ? `${t("domainLabel")} ${currentSiteDomain}`
      : `${t("domainLabel")} —`;
  }
  const brandSub = document.getElementById("brand-sub");
  if (brandSub) brandSub.textContent = t("brandSub");
}

// ---- Helpers ----

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;

function getChat(): HTMLElement { return document.getElementById("chat-messages") as HTMLElement; }

function scrollChat(): void {
  const c = getChat();
  c.scrollTop = c.scrollHeight;
}

/**
 * Zet URLs in tekst om naar klikbare links — GEEN innerHTML (XSS-veilig).
 * Bouwt DOM-nodes stuk voor stuk op zodat gebruikersinhoud nooit als HTML wordt geparsed.
 */
function linkify(container: HTMLElement, text: string): void {
  const URL_RE = /https?:\/\/[^\s<>"]+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) container.appendChild(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement("a");
    a.href = m[0];
    a.textContent = m[0];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    container.appendChild(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
}

// ---- Gate ----

/**
 * Leest de opgeslagen taalkeuze uit chrome.storage (yad:settings.language) VOORDAT de
 * poort getoond wordt. De poort verschijnt namelijk vóór de gewone taalknoppen, dus we
 * kunnen hier niet op currentLanguage vertrouwen. Zonder opgeslagen keuze: Nederlands,
 * want de Nederlandse versie is juridisch bindend.
 */
async function readSavedLang(): Promise<Lang> {
  try {
    const res = await chrome.storage.local.get("yad:settings");
    const s = res["yad:settings"] as { language?: string } | undefined;
    return s?.language === "en" ? "en" : "nl";
  } catch {
    return "nl";
  }
}

async function showGate(): Promise<void> {
  currentLanguage = await readSavedLang();
  $("#gate").classList.remove("hidden");
  $("#app").classList.add("hidden");
  // Statische poort-teksten (titel, doc-links, knop, concept-regel) in de gekozen taal.
  applyLang();
  const docLabels: Record<string, TKey> = {
    "algemene-voorwaarden": "gateDocTerms",
    "privacyverklaring": "gateDocPrivacy",
    "gebruiksbeleid": "gateDocAup",
  };
  document.querySelectorAll<HTMLAnchorElement>("#gate a[data-doc]").forEach((a) => {
    const key = docLabels[a.dataset["doc"] ?? ""];
    if (key) a.textContent = t(key);
  });
  (document.getElementById("gate-summary") as HTMLElement).textContent = loc(ACCEPT_SUMMARY);
  // Vertaal-melding: alleen in het Engels, en zonder de Nederlandse poort aan te raken.
  document.getElementById("gate-notice")?.remove();
  if (currentLanguage === "en") {
    const notice = document.createElement("p");
    notice.id = "gate-notice";
    notice.style.cssText = "font-size:12px;color:#6b7280;font-style:italic;margin:8px 0 0";
    notice.textContent = "This is a translation for your convenience. The Dutch version is the legally binding one.";
    (document.getElementById("gate-summary") as HTMLElement).after(notice);
  }
  const container = document.getElementById("gate-items") as HTMLElement;
  container.innerHTML = "";
  const boxes: HTMLInputElement[] = [];
  for (const item of ACCEPT_ITEMS) {
    const wrap = document.createElement("label");
    wrap.style.cssText = "display:flex;gap:8px;margin:10px 0;align-items:flex-start";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = `chk-${item.id}`;
    box.style.marginTop = "3px";
    const span = document.createElement("span");
    span.textContent = loc(item.text);
    wrap.append(box, span);
    container.append(wrap);
    boxes.push(box);
  }
  const acceptBtn = $<HTMLButtonElement>("#accept");
  const refresh = (): void => { acceptBtn.disabled = !boxes.every((b) => b.checked); };
  boxes.forEach((b) => b.addEventListener("change", refresh));
  refresh();
  acceptBtn.onclick = async (): Promise<void> => { await recordAcceptance(); startApp(); };
  document.querySelectorAll<HTMLAnchorElement>("#gate a[data-doc]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const doc = a.dataset["doc"];
      if (!doc) return;
      // In het Engels de vertaalde versie openen (Nederlands blijft juridisch leidend).
      const file = currentLanguage === "en" ? `legal/${doc}-en.html` : `legal/${doc}.html`;
      window.open(chrome.runtime.getURL(file), "_blank");
    });
  });
}

// ---- Tabs ----

function switchTab(name: string): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((b) =>
    b.classList.toggle("active", b.dataset["tab"] === name));
  document.querySelectorAll<HTMLElement>(".tab-panel").forEach((p) =>
    p.classList.toggle("hidden", p.id !== `tab-${name}`));
  if (name === "workflows") void renderWorkflows();
  if (name === "instellingen") void loadSettingsTab();
  if (name === "statistieken") void renderStats();
}

// ---- Connection ----

function renderConn(status: "verbonden" | "verbinden" | "verbroken"): void {
  $<HTMLElement>("#dot").className = `dot ${status}`;
  const lbl = { verbonden: "connConnected", verbinden: "connConnecting", verbroken: "connDisconnected" } as const;
  $<HTMLElement>("#conn-label").textContent = t(lbl[status]);
  $<HTMLButtonElement>("#start").disabled = status !== "verbonden";

  // Brein-ontbreekt-banner: alleen tonen als er echt geen companion is (verbroken),
  // met een directe downloadknop. Zo weet de gebruiker meteen wat te doen.
  const missing = document.getElementById("companion-missing");
  if (missing) {
    const show = status === "verbroken";
    missing.classList.toggle("hidden", !show);
    if (show) {
      const en = currentLanguage === "en";
      const txt = document.getElementById("cm-text");
      const btn = document.getElementById("cm-btn");
      if (txt) {
        txt.textContent = en
          ? "The companion is not running yet. Yad needs a small free helper app on your computer to think. Install it once, then reopen Yad."
          : "De companion draait nog niet. Yad heeft een klein gratis hulpprogramma op je computer nodig om na te denken. Installeer het één keer en open Yad opnieuw.";
      }
      if (btn) {
        btn.textContent = en
          ? "Download the companion (Windows)"
          : "Download de companion (Windows)";
      }
    }
  }
}

// ---- Chat messages ----

let typingEl: HTMLElement | null = null;
let confirmEl: HTMLElement | null = null;

function showTyping(): void {
  if (typingEl) return;
  const el = document.createElement("div");
  el.className = "typing-bubble";
  el.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  getChat().append(el);
  typingEl = el;
  scrollChat();
}

function hideTyping(): void { typingEl?.remove(); typingEl = null; }

function hideConfirm(): void { confirmEl?.remove(); confirmEl = null; }

// ---- Run state ----

let lastGoal = "";
let lastRunStatus: RunStatus | "" = "";
let runStartedAt = 0;
let runSteps = 0;
let lastSummary: string | undefined;
let localPlannenShown = false; // voorkomt dubbele user-bubble bij button-click

/**
 * Welkom-blok in de lege chat: legt in gewone taal uit wat Yad doet, wat je kunt
 * vragen, en geeft drie klikbare voorbeelden. Dit is het eerste wat een nieuwe
 * gebruiker ziet, en het maakt in één oogopslag duidelijk waarvoor Yad is.
 * Volledig via DOM-nodes opgebouwd (geen innerHTML) zodat er niets als HTML wordt geparsed.
 */
function renderWelcome(): void {
  const chat = getChat();
  if (document.getElementById("yad-welcome")) return;
  if (chat.querySelector(".cb, .typing-bubble, .confirm-bubble")) return; // alleen bij lege chat

  const wrap = document.createElement("div");
  wrap.id = "yad-welcome";

  const card = document.createElement("div");
  card.className = "wc-card";

  const title = document.createElement("p");
  title.className = "wc-title";
  title.textContent = t("welcomeTitle");

  const what = document.createElement("p");
  what.className = "wc-what";
  what.textContent = t("welcomeWhat");

  const canTitle = document.createElement("p");
  canTitle.className = "wc-sub";
  canTitle.textContent = t("welcomeCanTitle");

  const canList = document.createElement("ul");
  canList.className = "wc-can";
  (["welcomeCan1", "welcomeCan2", "welcomeCan3"] as const).forEach((k) => {
    const li = document.createElement("li");
    li.textContent = t(k);
    canList.append(li);
  });

  const tryTitle = document.createElement("p");
  tryTitle.className = "wc-sub";
  tryTitle.textContent = t("welcomeTryTitle");

  const exWrap = document.createElement("div");
  exWrap.className = "wc-ex";
  (["welcomeEx1", "welcomeEx2", "welcomeEx3"] as const).forEach((k) => {
    const exText = t(k);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wc-ex-btn";
    btn.textContent = exText;
    btn.onclick = (): void => {
      const goal = $<HTMLTextAreaElement>("#goal");
      goal.value = exText;
      goal.focus();
      goal.dispatchEvent(new Event("input"));
    };
    exWrap.append(btn);
  });

  const foot = document.createElement("div");
  foot.className = "wc-foot";
  const lock = document.createElement("span");
  lock.className = "wc-lock";
  lock.textContent = "🔒";
  const footText = document.createElement("span");
  footText.textContent = t("welcomePrivacy");
  foot.append(lock, footText);

  card.append(title, what, canTitle, canList, tryTitle, exWrap, foot);

  const hint = document.createElement("p");
  hint.className = "wc-hint";
  hint.textContent = t("welcomeHint");

  const biz = document.createElement("div");
  biz.className = "wc-biz";
  const bizTitle = document.createElement("p");
  bizTitle.className = "wc-biz-title";
  bizTitle.textContent = t("bizTitle");
  const bizText = document.createElement("p");
  bizText.className = "wc-biz-text";
  bizText.textContent = t("bizText");
  const bizCta = document.createElement("a");
  bizCta.className = "wc-biz-cta";
  bizCta.href = "mailto:info@mergefix.com";
  bizCta.textContent = t("bizCta");
  biz.append(bizTitle, bizText, bizCta);

  wrap.append(card, hint, biz);
  chat.append(wrap);
}

function removeWelcome(): void {
  document.getElementById("yad-welcome")?.remove();
}

function addLog(status: RunStatus, message: string, step?: number): void {
  removeWelcome();
  if (step) runSteps = Math.max(runSteps, step);
  lastRunStatus = status;

  const chat = getChat();

  if (status === "plannen") {
    const u = document.createElement("div");
    u.className = "cb u";
    u.textContent = lastGoal;
    chat.append(u);
    showTyping();
    scrollChat();
  } else if (status === "bezig") {
    hideTyping();
    const el = document.createElement("div");
    el.className = "cb step";
    el.textContent = message;
    chat.append(el);
    showTyping();
    scrollChat();
  } else if (status === "klaar") {
    lastSummary = message;
    hideTyping();
    const ans = document.createElement("div");
    ans.className = "cb a ok";
    const txt = document.createElement("div");
    linkify(txt, message);
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "cb-copy";
    copyBtn.textContent = t("copyBtn");
    copyBtn.onclick = (): void => {
      void navigator.clipboard.writeText(message);
      copyBtn.textContent = t("copiedBtn");
      setTimeout(() => { copyBtn.textContent = t("copyBtn"); }, 2000);
    };
    ans.append(txt, copyBtn);
    chat.append(ans);
    scrollChat();
  } else {
    hideTyping();
    const el = document.createElement("div");
    el.className = "cb a err";
    el.textContent = message;
    chat.append(el);
    scrollChat();
  }

  if (["klaar", "fout", "gestopt", "geweigerd"].includes(status)) {
    $<HTMLButtonElement>("#start").disabled = false;
    void addHistoryEntry({
      id: crypto.randomUUID(),
      goal: lastGoal,
      status,
      steps: runSteps,
      summary: status === "klaar" ? lastSummary : undefined,
      startedAt: runStartedAt,
    });
    if (status === "klaar") {
      $("#bewaar-form").classList.remove("hidden");
      $<HTMLInputElement>("#bewaar-naam").value = lastGoal.slice(0, 50);
    }
  }
}

function showConfirm(id: string, action: unknown, reason: string): void {
  hideConfirm();
  const el = document.createElement("div");
  el.className = "confirm-bubble";
  const p = document.createElement("div");
  p.style.marginBottom = "4px";
  p.textContent = reason;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(action, null, 2);
  const btns = document.createElement("div");
  btns.className = "confirm-btns";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "cyes";
  yes.textContent = t("confirmYes");
  const no = document.createElement("button");
  no.type = "button";
  no.className = "cno";
  no.textContent = t("confirmNo");
  const respond = (approved: boolean): void => {
    void chrome.runtime.sendMessage({ type: "YAD_CONFIRM_RESPONSE", id, approved });
    hideConfirm();
  };
  yes.onclick = (): void => respond(true);
  no.onclick = (): void => respond(false);
  btns.append(yes, no);
  el.append(p, pre, btns);
  getChat().append(el);
  scrollChat();
  confirmEl = el;
}

// ---- Attachments ----

const pendingAttachments: PendingAttachment[] = [];
let pendingDocText: string | null = null;
let pendingDocName = "";

/** Ruwe RTF → leesbare tekst: strip controlewoorden, bewaar alinea-einden en tekst. */
function extractRtfText(rtf: string): string {
  let t = rtf;
  // Hexadecimale escapes \'XX → karakter (Windows-1252 / Latin-1)
  t = t.replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // Verwijder geneste RTF-groepen (fonttbl, colortbl, pict, info, …) — maximaal 6 rondes
  for (let i = 0; i < 6; i++) t = t.replace(/\{[^{}]*\}/g, " ");
  // Controlekopwoorden met alinea-betekenis → newline/tab
  t = t.replace(/\\par\b\s?/g, "\n").replace(/\\line\b\s?/g, "\n").replace(/\\tab\b\s?/g, "\t");
  // Alle overige controlekopwoorden (incl. \pard, \b, \i, \f0, …) → spatie
  t = t.replace(/\\[a-zA-Z0-9]+(-?\d+)?\s?/g, " ");
  t = t.replace(/\\./g, " ");          // resterende \ + karakter
  t = t.replace(/[{}]/g, " ");         // openstaande accolades
  return t.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function renderDocChip(): void {
  document.getElementById("doc-chip-el")?.remove();
  if (pendingDocText === null) return;
  const c = document.getElementById("attach-previews") as HTMLElement;
  const chip = document.createElement("span");
  chip.id = "doc-chip-el";
  chip.className = "attach-thumb doc-chip";
  const icon = document.createElement("span");
  icon.textContent = "📄 ";
  const nm = document.createElement("span");
  nm.textContent = pendingDocName.length > 18 ? pendingDocName.slice(0, 16) + "…" : pendingDocName;
  const rm = document.createElement("button");
  rm.type = "button"; rm.className = "attach-remove"; rm.title = t("removeTitle"); rm.textContent = "✕";
  rm.onclick = (): void => { pendingDocText = null; pendingDocName = ""; renderDocChip(); };
  chip.append(icon, nm, rm);
  c.prepend(chip);
}

function showAttachError(msg: string): void {
  document.getElementById("attach-error-el")?.remove();
  const c = document.getElementById("attach-previews") as HTMLElement;
  const el = document.createElement("div");
  el.id = "attach-error-el";
  el.className = "attach-thumb";
  el.style.cssText = "background:#fef2f2;border-color:#fecaca;color:#b91c1c;width:100%;justify-content:space-between";
  const txt = document.createElement("span");
  txt.textContent = msg;
  const rm = document.createElement("button");
  rm.type = "button"; rm.className = "attach-remove"; rm.title = t("closeTitle"); rm.textContent = "✕";
  rm.onclick = (): void => { el.remove(); };
  el.append(txt, rm);
  c.prepend(el);
  setTimeout(() => el.remove(), 8000);
}

function addDocAttachment(file: File): void {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["txt", "rtf"].includes(ext)) {
    showAttachError(`❌ ${file.name.slice(0, 22)}: ${t("attachUnreadable")}`);
    return;
  }
  const reader = new FileReader();
  reader.onload = (): void => {
    let text = reader.result as string;
    if (ext === "rtf") text = extractRtfText(text);
    if (text.length > 8000) text = text.slice(0, 8000) + "…";
    pendingDocText = text;
    pendingDocName = file.name;
    renderDocChip();
  };
  reader.readAsText(file, "utf-8");
}

function renderAttachPreviews(): void {
  const c = document.getElementById("attach-previews") as HTMLElement;
  // Bewaar de doc-chip — alleen afbeelding-thumbs wissen
  const docChip = document.getElementById("doc-chip-el");
  c.innerHTML = "";
  if (docChip) c.append(docChip);
  for (let i = 0; i < pendingAttachments.length; i++) {
    const a = pendingAttachments[i]!;
    const thumb = document.createElement("span");
    thumb.className = "attach-thumb";
    const img = document.createElement("img");
    img.src = a.previewUrl; img.alt = a.name;
    const nm = document.createElement("span");
    nm.textContent = a.name.length > 18 ? a.name.slice(0, 16) + "…" : a.name;
    const rm = document.createElement("button");
    rm.type = "button"; rm.className = "attach-remove"; rm.title = t("removeTitle"); rm.textContent = "✕";
    const idx = i;
    rm.onclick = (): void => {
      URL.revokeObjectURL(pendingAttachments[idx]?.previewUrl ?? "");
      pendingAttachments.splice(idx, 1);
      renderAttachPreviews();
    };
    thumb.append(img, nm, rm);
    c.append(thumb);
  }
}

function addImageAttachment(file: File): void {
  const reader = new FileReader();
  reader.onload = (): void => {
    const dataUrl = reader.result as string;
    const comma = dataUrl.indexOf(",");
    pendingAttachments.push({
      mimeType: file.type || "image/png",
      data: dataUrl.slice(comma + 1),
      name: file.name || "image.png",
      previewUrl: URL.createObjectURL(file),
    });
    renderAttachPreviews();
  };
  reader.readAsDataURL(file);
}

function clearAttachments(): void {
  for (const a of pendingAttachments) URL.revokeObjectURL(a.previewUrl);
  pendingAttachments.length = 0;
  renderAttachPreviews();
  pendingDocText = null;
  pendingDocName = "";
  renderDocChip();
}

// ---- Workflows tab ----

async function renderWorkflows(): Promise<void> {
  const workflows = await getWorkflows();
  const history = await getHistory();
  const wList = $("#workflow-list");
  wList.innerHTML = "";
  if (workflows.length === 0) {
    const p = document.createElement("p"); p.className = "empty-state";
    p.textContent = t("noSavedTasks"); wList.append(p);
  } else {
    for (const wf of workflows) {
      const item = document.createElement("div"); item.className = "workflow-item";
      const info = document.createElement("div"); info.className = "workflow-info";
      const nm = document.createElement("div"); nm.className = "workflow-name"; nm.textContent = wf.name;
      const gl = document.createElement("div"); gl.className = "workflow-goal"; gl.title = wf.goal; gl.textContent = wf.goal;
      info.append(nm, gl);
      const acts = document.createElement("div"); acts.className = "workflow-actions";
      const startBtn = document.createElement("button"); startBtn.type = "button"; startBtn.className = "wf-start small";
      startBtn.textContent = t("tabTask");
      startBtn.onclick = (): void => { $<HTMLTextAreaElement>("#goal").value = wf.goal; switchTab("taak"); startBtnClick(); };
      const delBtn = document.createElement("button"); delBtn.type = "button"; delBtn.className = "wf-del small danger";
      delBtn.textContent = "✕";
      delBtn.onclick = async (): Promise<void> => { await deleteWorkflow(wf.id); void renderWorkflows(); };
      acts.append(startBtn, delBtn); item.append(info, acts); wList.append(item);
    }
  }
  const hList = $("#history-list"); hList.innerHTML = "";
  if (history.length === 0) {
    const p = document.createElement("p"); p.className = "empty-state"; p.textContent = t("noHistory"); hList.append(p);
  } else {
    for (const entry of history) {
      const item = document.createElement("div"); item.className = "history-item";
      const dot = document.createElement("span"); dot.className = `history-status ${entry.status}`;
      const gl = document.createElement("span"); gl.className = "history-goal"; gl.title = entry.goal; gl.textContent = entry.goal;
      const meta = document.createElement("span"); meta.className = "history-meta"; meta.textContent = `${entry.steps}st`;
      item.append(dot, gl, meta); hList.append(item);
    }
  }
}

// ---- Stats tab ----

async function renderStats(): Promise<void> {
  const history = await getHistory();
  const c = document.getElementById("stats-content") as HTMLElement;
  if (history.length === 0) {
    c.innerHTML = `<p class="empty-state">${t("noStats")}</p>`; return;
  }
  const total = history.length;
  const succeeded = history.filter((h) => h.status === "klaar").length;
  const successRate = total > 0 ? Math.round((succeeded / total) * 100) : 0;
  const avgSteps = total > 0 ? Math.round(history.reduce((s, h) => s + h.steps, 0) / total) : 0;
  const goalCount = new Map<string, number>();
  for (const h of history) {
    const key = h.goal.slice(0, 60).toLowerCase().trim();
    goalCount.set(key, (goalCount.get(key) ?? 0) + 1);
  }
  const topGoals = [...goalCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  c.innerHTML = "";
  const grid = document.createElement("div"); grid.className = "stat-grid";
  const mkCard = (lbl: string, val: string, sub: string): HTMLElement => {
    const card = document.createElement("div"); card.className = "stat-card";
    card.innerHTML = `<div class="stat-label">${lbl}</div><div class="stat-value">${val}</div><div class="stat-sub">${sub}</div>`;
    return card;
  };
  grid.append(
    mkCard(t("statsRuns"), String(total), t("statsTotal")),
    mkCard(t("statsSucceeded"), `${successRate}%`, `${succeeded} / ${total}`),
    mkCard(t("statsAvgSteps"), String(avgSteps), t("statsPerRun")),
    mkCard(t("statsFailed"), String(total - succeeded), t("statsAborted")),
  );
  c.append(grid);
  const bw = document.createElement("div"); bw.className = "stat-bar-wrap";
  bw.innerHTML = `<div class="stat-bar-label"><span>${t("statsSuccessRate")}</span><span>${successRate}%</span></div><div class="stat-bar-track"><div class="stat-bar-fill" style="width:${successRate}%"></div></div>`;
  c.append(bw);
  if (topGoals.length > 0) {
    const h = document.createElement("p"); h.className = "section-title"; h.style.marginTop = "12px";
    h.textContent = t("statsTopTasks"); c.append(h);
    for (const [goal, count] of topGoals) {
      const row = document.createElement("div"); row.className = "top-goal"; row.title = goal;
      row.textContent = `${count}× ${goal}`; c.append(row);
    }
  }
}

// ---- Settings tab ----

function refreshModeState(): void {
  document.querySelectorAll<HTMLButtonElement>(".qmode-btn, .mode-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset["mode"] === currentAutonomy));
}

function refreshLangState(): void {
  document.querySelectorAll<HTMLButtonElement>(".qlang-btn, .lang-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset["lang"] === currentLanguage));
  applyLang();
  renderKillBtn();
  if (document.getElementById("yad-welcome")) { removeWelcome(); renderWelcome(); }
  // Her-render de in-JS opgebouwde provider-catalogus in de nieuwe taal (die gaat niet via applyLang).
  const sp = document.getElementById("tab-instellingen");
  if (sp && !sp.classList.contains("hidden")) {
    void getSettings().then((s) => renderProviderCatalog(s));
  }
}

async function loadSettingsTab(): Promise<void> {
  const settings = await getSettings();
  lastLoadedSettings = settings;
  // Taal eerst zetten: renderProviderCatalog gebruikt currentLanguage voor de uitleg-tekst.
  currentLanguage = settings.language === "en" ? "en" : "nl";
  renderProviderCatalog(settings);
  $<HTMLInputElement>("#s-steps").value = String(settings.maxSteps);
  $<HTMLElement>("#steps-val").textContent = String(settings.maxSteps);
  const cap = settings.maxRequestsPerDay ?? 1000;
  $<HTMLInputElement>("#s-daily-cap").value = String(cap);
  $<HTMLElement>("#cap-val").textContent = String(cap);
  currentKilled = settings.killed ?? false;
  renderKillBtn();
  currentAutonomy = settings.autonomy === "auto" ? "auto" : "confirm";
  currentLanguage = settings.language === "en" ? "en" : "nl";
  refreshModeState();
  refreshLangState();
  chrome.runtime.sendMessage({ type: "YAD_GET_CURRENT_TAB_URL" }, (resp?: { url: string }) => {
    if (chrome.runtime.lastError) return;
    const url = resp?.url ?? "";
    try { currentSiteDomain = url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : ""; }
    catch { currentSiteDomain = ""; }
    const lbl = document.getElementById("site-domain-label");
    if (lbl) lbl.textContent = currentSiteDomain ? `${t("domainLabel")} ${currentSiteDomain}` : `${t("domainLabel")} —`;
    void refreshTierButtons();
  });
}

async function refreshTierButtons(): Promise<void> {
  if (!currentSiteDomain) return;
  const overrides = await getSiteOverrides();
  const active = overrides[currentSiteDomain] ?? "null";
  document.querySelectorAll<HTMLButtonElement>(".tier-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset["tier"] === active));
}

function renderProviderCatalog(settings: YadSettings): void {
  const c = $("#provider-catalog"); c.innerHTML = "";
  const en = currentLanguage === "en";

  // Simpele modus: één korte uitleg + het aanbevolen brein bovenaan open, de rest inklapbaar.
  const intro = document.createElement("p");
  intro.className = "simple-intro";
  intro.textContent = en
    ? "Pick one AI brain. Recommended: Groq, free and ready in about two minutes. Click Sign up, paste the key, then Save below."
    : "Kies één AI-brein. Aanbevolen: Groq, gratis en klaar in zo'n twee minuten. Klik Aanmelden, plak de sleutel, dan hieronder Opslaan.";
  c.append(intro);

  // Sleutel-veiligheid + coaching, precies waar de gebruiker zijn sleutel plakt.
  const safety = document.createElement("p");
  safety.style.cssText = "font-size:11.5px;color:#3f6212;background:#f7fee7;border:1px solid #d9f99d;border-radius:6px;padding:8px 10px;margin:0 0 10px;line-height:1.45";
  safety.textContent = en
    ? "Your key stays on your computer and only goes to the AI provider you pick. Tip: create a separate key just for Yad and put a spending cap on it, so you stay in full control."
    : "Je sleutel blijft op je computer en gaat alleen naar de AI-provider die jij kiest. Tip: maak een aparte sleutel speciaal voor Yad met een uitgavenlimiet, dan houd je volledig de controle.";
  c.append(safety);

  const first = PROVIDER_CATALOG[0];
  if (first) {
    const cfg = settings.providers[first.id] ?? { enabled: false, key: "" };
    c.append(buildProviderCard(first, cfg, { recommended: true }));
  }

  const rest = PROVIDER_CATALOG.slice(1);
  if (rest.length) {
    const details = document.createElement("details");
    details.className = "advanced-providers";
    const summary = document.createElement("summary");
    summary.textContent = en ? "More options (advanced)" : "Meer opties (gevorderd)";
    details.append(summary);
    for (const entry of rest) {
      const config = settings.providers[entry.id] ?? { enabled: false, key: "" };
      details.append(buildProviderCard(entry, config));
    }
    c.append(details);
  }
}

function buildProviderCard(entry: ProviderCatalogEntry, config: ProviderUserConfig, opts: { recommended?: boolean } = {}): HTMLElement {
  const card = document.createElement("div");
  card.className = `provider-card${config.enabled ? " active" : ""}`;
  card.dataset["search"] = `${loc(entry.name)} ${loc(entry.tagline)} ${entry.id}`.toLowerCase();
  const header = document.createElement("div"); header.className = "provider-header";
  const chk = document.createElement("input"); chk.type = "checkbox";
  chk.id = `prov-${entry.id}-enabled`; chk.checked = config.enabled;
  const nameLabel = document.createElement("label"); nameLabel.htmlFor = chk.id;
  nameLabel.className = "provider-name"; nameLabel.textContent = loc(entry.name);
  const badge = document.createElement("span"); badge.className = `provider-badge ${entry.tier}`; badge.textContent = loc(entry.badge);
  header.append(chk, nameLabel, badge);
  if (opts.recommended) {
    const rec = document.createElement("span");
    rec.className = "provider-badge recommended";
    rec.textContent = currentLanguage === "en" ? "RECOMMENDED" : "AANBEVOLEN";
    header.append(rec);
  }
  // Toon "✓ via companion" als de companion deze provider actief heeft vanuit zijn .env maar de gebruiker er geen sleutel voor heeft ingesteld
  if (companionActiveProviders.includes(entry.id) && !config.enabled) {
    const companionBadge = document.createElement("span");
    companionBadge.className = "provider-badge companion";
    companionBadge.title = t("provCompanionActiveTitle");
    companionBadge.textContent = t("provCompanionActive");
    header.append(companionBadge);
  }
  const detail = document.createElement("div"); detail.className = "provider-detail";
  const tagline = document.createElement("div"); tagline.className = "provider-tagline"; tagline.textContent = loc(entry.tagline);
  const meta = document.createElement("div"); meta.className = "provider-meta";
  if (entry.freeLimit) {
    const lim = document.createElement("span"); lim.className = "provider-limit"; lim.textContent = loc(entry.freeLimit); meta.append(lim);
  }
  const stars = document.createElement("span"); stars.className = "provider-stars";
  stars.textContent = "★".repeat(entry.quality) + "☆".repeat(5 - entry.quality);
  const signupBtn = document.createElement("button"); signupBtn.type = "button";
  signupBtn.className = "provider-signup"; signupBtn.textContent = t("provSignup");
  signupBtn.onclick = (): void => { window.open(entry.signupUrl, "_blank"); };
  meta.append(stars, signupBtn); detail.append(tagline, meta);
  const fields = document.createElement("div"); fields.className = "provider-fields";
  if (!config.enabled && !opts.recommended) fields.classList.add("hidden");
  if (entry.requiresKey) {
    // Een versleutelde blob NOOIT in het veld tonen: leeg + duidelijke placeholder.
    const savedEncrypted = config.encrypted && !!config.key;
    const shownValue = savedEncrypted ? "" : config.key;
    const shownPlaceholder = savedEncrypted
      ? (currentLanguage === "en" ? "🔒 Saved, encrypted on this device" : "🔒 Opgeslagen, versleuteld op dit apparaat")
      : loc(entry.keyPlaceholder);
    fields.append(buildKeyField(`prov-${entry.id}-key`, t("provKeyLabel"), shownValue, shownPlaceholder));
  }
  if (entry.supportsModel) fields.append(buildTextField(`prov-${entry.id}-model`, t("provModelLabel"), config.model ?? "", `${t("provModelPh")} ${entry.defaultModel}`));
  if (entry.supportsBaseUrl) {
    const defUrl = entry.defaultBaseUrl ?? "";
    fields.append(buildTextField(`prov-${entry.id}-baseUrl`, entry.id === "ollama" ? "Ollama URL" : "Base URL", config.baseUrl || defUrl, defUrl));
  }
  if (entry.supportsPrimary) {
    const pDiv = document.createElement("div"); pDiv.className = "field";
    const pLbl = document.createElement("label"); pLbl.className = "field-check";
    const pChk = document.createElement("input"); pChk.type = "checkbox";
    pChk.id = `prov-${entry.id}-primary`; pChk.checked = config.primary ?? false;
    pLbl.append(pChk, document.createTextNode(" " + t("provPrimaryLabel")));
    pDiv.append(pLbl); fields.append(pDiv);
  }
  chk.onchange = (): void => { card.classList.toggle("active", chk.checked); fields.classList.toggle("hidden", !chk.checked); };
  // Aanbevolen kaart: zodra iemand een sleutel plakt, zet de provider vanzelf aan.
  // Dicht de stille val waarbij een geplakte sleutel genegeerd werd omdat het vinkje uit stond.
  if (opts.recommended) {
    const keyInput = fields.querySelector<HTMLInputElement>("input[type=password]");
    keyInput?.addEventListener("input", () => {
      const on = keyInput.value.trim().length > 0;
      chk.checked = on;
      card.classList.toggle("active", on);
    });
  }
  card.append(header, detail, fields);
  return card;
}

function buildKeyField(id: string, label: string, value: string, placeholder: string): HTMLElement {
  const div = document.createElement("div"); div.className = "field";
  const lbl = document.createElement("label"); lbl.textContent = label;
  const row = document.createElement("div"); row.className = "field-row";
  const inp = document.createElement("input"); inp.type = "password"; inp.id = id;
  inp.value = value; inp.placeholder = placeholder; inp.autocomplete = "new-password";
  const show = document.createElement("button"); show.type = "button";
  show.className = "secondary small toggle-show"; show.textContent = t("provShow");
  show.onclick = (): void => { inp.type = inp.type === "password" ? "text" : "password"; show.textContent = inp.type === "password" ? t("provShow") : t("provHide"); };
  row.append(inp, show); div.append(lbl, row); return div;
}

function buildTextField(id: string, label: string, value: string, placeholder: string): HTMLElement {
  const div = document.createElement("div"); div.className = "field";
  const lbl = document.createElement("label"); lbl.textContent = label;
  const inp = document.createElement("input"); inp.type = "text"; inp.id = id;
  inp.value = value; inp.placeholder = placeholder;
  div.append(lbl, inp); return div;
}

function collectSettings(): YadSettings {
  const providers: Record<string, ProviderUserConfig> = {};
  for (const entry of PROVIDER_CATALOG) {
    const enabledEl = document.getElementById(`prov-${entry.id}-enabled`) as HTMLInputElement | null;
    if (!enabledEl) continue;
    const typedKey = (document.getElementById(`prov-${entry.id}-key`) as HTMLInputElement | null)?.value.trim() ?? "";
    const prevCfg = lastLoadedSettings?.providers[entry.id];
    // Veld leeg gelaten + er stond al een versleutelde blob: die blob behouden (niet wissen,
    // en NOOIT de kale blob-placeholder als "nieuwe sleutel" zien). Iets getypt = nieuwe platte
    // sleutel; die wordt dit rondje nog eenmaal plat verstuurd en daarna versleuteld teruggekregen.
    const config: ProviderUserConfig =
      typedKey === "" && prevCfg?.encrypted && prevCfg.key
        ? { enabled: enabledEl.checked, key: prevCfg.key, encrypted: true }
        : { enabled: enabledEl.checked, key: typedKey };
    const model = (document.getElementById(`prov-${entry.id}-model`) as HTMLInputElement | null)?.value.trim();
    if (model) config.model = model;
    const baseUrl = (document.getElementById(`prov-${entry.id}-baseUrl`) as HTMLInputElement | null)?.value.trim();
    if (baseUrl) config.baseUrl = baseUrl;
    const primaryEl = document.getElementById(`prov-${entry.id}-primary`) as HTMLInputElement | null;
    if (primaryEl) config.primary = primaryEl.checked;
    providers[entry.id] = config;
  }
  return { providers, maxSteps: parseInt($<HTMLInputElement>("#s-steps").value, 10) || 15, autonomy: currentAutonomy, language: currentLanguage, maxRequestsPerDay: parseInt($<HTMLInputElement>("#s-daily-cap").value, 10) || 1000, killed: currentKilled };
}

// ---- Start button ----

function startBtnClick(): void {
  const goalEl = $<HTMLTextAreaElement>("#goal");
  let goal = goalEl.value.trim();
  // Voeg CV-context toe als er een document is bijgevoegd
  if (pendingDocText) {
    const defaultGoal = goal || t("cvDefaultGoal");
    goal = `${t("cvContextPrefix")} (${pendingDocName}):\n\n${pendingDocText}\n\n---\n\n${defaultGoal}`;
  }
  if (!goal) return;
  lastGoal = goal;
  lastRunStatus = "";
  runStartedAt = Date.now();
  runSteps = 0;
  lastSummary = undefined;
  $<HTMLButtonElement>("#start").disabled = true;
  $("#bewaar-form").classList.add("hidden");
  goalEl.value = "";
  goalEl.style.height = "auto";
  localPlannenShown = true;
  addLog("plannen", `Taak gestart: ${pendingDocText ? `CV bijgevoegd + ${pendingDocName}` : goal}`);
  const attachments = pendingAttachments.map((a) => ({ type: "image" as const, mimeType: a.mimeType, data: a.data, name: a.name }));
  clearAttachments();
  void chrome.runtime.sendMessage({ type: "YAD_GOAL", goal, ...(attachments.length ? { attachments } : {}) });
}

// ---- App startup ----

function startApp(): void {
  $("#gate").classList.add("hidden");
  $("#app").classList.remove("hidden");

  // Apply saved language immediately
  void getSettings().then((s) => {
    currentLanguage = s.language === "en" ? "en" : "nl";
    currentAutonomy = s.autonomy === "auto" ? "auto" : "confirm";
    refreshModeState();
    refreshLangState();
    renderWelcome();
  });

  chrome.runtime.sendMessage({ type: "YAD_GET_STATUS" }, (resp?: { status: string }) => {
    if (resp) renderConn(resp.status as "verbonden" | "verbinden" | "verbroken");
  });

  // Tabs
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((b) =>
    b.addEventListener("click", () => { const tab = b.dataset["tab"]; if (tab) switchTab(tab); }));

  // Quick topbar: mode
  document.querySelectorAll<HTMLButtonElement>(".qmode-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const m = b.dataset["mode"];
      if (m === "confirm" || m === "auto") { currentAutonomy = m; refreshModeState(); }
    }));

  // Quick topbar: lang
  document.querySelectorAll<HTMLButtonElement>(".qlang-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const l = b.dataset["lang"];
      if (l === "nl" || l === "en") { currentLanguage = l; refreshLangState(); }
    }));

  // Settings tab: mode buttons
  document.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const m = b.dataset["mode"];
      if (m === "confirm" || m === "auto") { currentAutonomy = m; refreshModeState(); }
    }));

  // Settings tab: lang buttons
  document.querySelectorAll<HTMLButtonElement>(".lang-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const l = b.dataset["lang"];
      if (l === "nl" || l === "en") { currentLanguage = l; refreshLangState(); }
    }));

  // Start button
  $<HTMLButtonElement>("#start").onclick = startBtnClick;

  // Clear chat
  $<HTMLButtonElement>("#clear").onclick = (): void => {
    getChat().innerHTML = "";
    hideTyping(); hideConfirm();
    clearAttachments();
    $("#bewaar-form").classList.add("hidden");
    lastRunStatus = "";
    renderWelcome();
  };

  // Bewaar form
  $<HTMLButtonElement>("#bewaar-ok").onclick = async (): Promise<void> => {
    const name = $<HTMLInputElement>("#bewaar-naam").value.trim() || lastGoal.slice(0, 40);
    if (name && lastGoal) await addWorkflow(name, lastGoal);
    $("#bewaar-form").classList.add("hidden");
  };
  $<HTMLButtonElement>("#bewaar-skip").onclick = (): void => { $("#bewaar-form").classList.add("hidden"); };

  // Max steps slider
  $<HTMLInputElement>("#s-steps").addEventListener("input", () => {
    $<HTMLElement>("#steps-val").textContent = $<HTMLInputElement>("#s-steps").value;
  });

  // Dag-limiet-schuif
  $<HTMLInputElement>("#s-daily-cap").addEventListener("input", () => {
    $<HTMLElement>("#cap-val").textContent = $<HTMLInputElement>("#s-daily-cap").value;
  });

  // Noodstop: direct opslaan + naar de companion sturen (niet wachten op Opslaan).
  document.getElementById("kill-toggle")?.addEventListener("click", () => {
    currentKilled = !currentKilled;
    renderKillBtn();
    void saveSettings(collectSettings()).then(() => {
      void chrome.runtime.sendMessage({ type: "YAD_UPDATE_CONFIG" });
    });
  });

  // Provider search
  $<HTMLInputElement>("#provider-search").addEventListener("input", (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase().trim();
    // Bij zoeken de "meer opties"-inklap openen, anders blijven treffers erin verborgen.
    const adv = document.querySelector<HTMLDetailsElement>("details.advanced-providers");
    if (adv) adv.open = q !== "";
    let visible = 0;
    document.querySelectorAll<HTMLElement>(".provider-card").forEach((c) => {
      const match = q === "" || (c.dataset["search"] ?? "").includes(q);
      c.classList.toggle("hidden", !match);
      if (match) visible++;
    });
    const cat = $<HTMLElement>("#provider-catalog");
    let note = cat.querySelector<HTMLElement>(".no-results");
    if (visible === 0) {
      if (!note) { note = document.createElement("p"); note.className = "no-results"; note.textContent = t("provNoResults"); cat.append(note); }
    } else if (note) note.remove();
  });

  // Site tier buttons
  document.querySelectorAll<HTMLButtonElement>(".tier-btn").forEach((b) =>
    b.addEventListener("click", async () => {
      const tier = b.dataset["tier"];
      if (!currentSiteDomain || !tier) return;
      const t2 = tier === "null" ? null : (tier as "stealth" | "normal" | "fast");
      await setSiteOverride(currentSiteDomain, t2);
      void refreshTierButtons();
    }));

  // REDACTED sessie-capture knoppen
  const captureMsg = document.getElementById("capture-msg") as HTMLElement | null;
  function setCaptureMsg(text: string, type: "ok" | "err" | ""): void {
    if (!captureMsg) return;
    captureMsg.textContent = text;
    captureMsg.className = type;
  }
  function setCaptureLoading(loading: boolean): void {
    const a = document.getElementById("capture-a") as HTMLButtonElement | null;
    const b = document.getElementById("capture-b") as HTMLButtonElement | null;
    if (a) a.disabled = loading;
    if (b) b.disabled = loading;
  }
  document.getElementById("capture-a")?.addEventListener("click", () => {
    setCaptureMsg(t("capturingMsg"), "");
    setCaptureLoading(true);
    void chrome.runtime.sendMessage({ type: "YAD_CAPTURE_SESSION", label: "A" });
  });
  document.getElementById("capture-b")?.addEventListener("click", () => {
    setCaptureMsg(t("capturingMsg"), "");
    setCaptureLoading(true);
    void chrome.runtime.sendMessage({ type: "YAD_CAPTURE_SESSION", label: "B" });
  });

  // Claude bridge
  const claudeMsg = document.getElementById("claude-capture-msg") as HTMLElement | null;
  function setClaudeMsg(text: string, type: "ok" | "err" | ""): void {
    if (!claudeMsg) return;
    claudeMsg.textContent = text;
    claudeMsg.className = type;
  }
  document.getElementById("claude-capture-btn")?.addEventListener("click", () => {
    setClaudeMsg(t("claudeCapturingMsg"), "");
    const btn = document.getElementById("claude-capture-btn") as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    void chrome.runtime.sendMessage({ type: "YAD_CAPTURE_FOR_CLAUDE" });
  });

  // Save settings
  $<HTMLFormElement>("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const settings = collectSettings();
    // Eigen/custom endpoint: waarschuw voor je de sleutel naar een zelf-ingevoerde URL stuurt (voetangel).
    for (const id of ["custom", "paid"]) {
      const p = settings.providers[id];
      if (p?.enabled && p.key && p.baseUrl) {
        let host = p.baseUrl;
        try { host = new URL(p.baseUrl).host; } catch { /* toon ruwe waarde als URL onparseerbaar is */ }
        const en = currentLanguage === "en";
        const ok = window.confirm(en
          ? `You are about to send your API key to ${host}. Only continue if you trust this address. Is that correct?`
          : `Je staat op het punt je API-sleutel naar ${host} te sturen. Ga alleen door als je dit adres vertrouwt. Klopt dat?`);
        if (!ok) return;
      }
    }
    await saveSettings(settings);
    void chrome.runtime.sendMessage({ type: "YAD_UPDATE_CONFIG" });
    const msg = $<HTMLElement>("#save-msg");
    msg.textContent = t("savedMsg");
    setTimeout(() => { msg.textContent = ""; }, 3000);
  });

  // Upload bijlage — één knop voor afbeeldingen én documenten (.txt, .rtf)
  document.getElementById("attach-btn")?.addEventListener("click", () => {
    document.getElementById("attach-input")?.click();
  });
  document.getElementById("attach-input")?.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      if (file.type.startsWith("image/")) addImageAttachment(file);
      else addDocAttachment(file);
    }
    input.value = "";
  });

  // Paste image
  document.addEventListener("paste", (e: ClipboardEvent) => {
    const items = e.clipboardData?.items ?? [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { addImageAttachment(file); e.preventDefault(); break; }
      }
    }
  });

  // Auto-resize textarea + Enter to send
  const goalEl = $<HTMLTextAreaElement>("#goal");
  goalEl.addEventListener("input", () => {
    goalEl.style.height = "auto";
    goalEl.style.height = Math.min(goalEl.scrollHeight, 110) + "px";
  });
  goalEl.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!$<HTMLButtonElement>("#start").disabled) startBtnClick();
    }
  });

  // Background messages
  chrome.runtime.onMessage.addListener((msg: {
    type?: string; status?: string; message?: string; step?: number;
    id?: string; action?: unknown; reason?: string; activeProviders?: string[];
    ok?: boolean; brand?: string; path?: string; authType?: string; detail?: string; label?: string;
  }) => {
    if (msg?.type === "YAD_STATUS" && msg.status)
      renderConn(msg.status as "verbonden" | "verbinden" | "verbroken");
    else if (msg?.type === "YAD_RUN_UPDATE" && msg.status) {
      // "plannen" van de companion is een echo van de button-click — sla over als we
      // de bubble al lokaal hebben getoond om dubbele user-berichten te voorkomen.
      if (msg.status === "plannen" && localPlannenShown) {
        localPlannenShown = false;
      } else {
        addLog(msg.status as RunStatus, msg.message ?? "", msg.step);
      }
    }
    else if (msg?.type === "YAD_CONFIRM_REQUEST" && msg.id)
      showConfirm(msg.id, msg.action, msg.reason ?? t("confirmFallback"));
    else if (msg?.type === "YAD_CONFIRM_EXPIRED")
      hideConfirm();
    else if (msg?.type === "YAD_COMPANION_CONFIG" && Array.isArray(msg.activeProviders)) {
      companionActiveProviders = msg.activeProviders;
      const settingsPanel = document.getElementById("tab-instellingen");
      if (settingsPanel && !settingsPanel.classList.contains("hidden")) void loadSettingsTab();
    }
    else if (msg?.type === "YAD_SESSION_CAPTURING") {
      const lbl = document.getElementById("capture-msg");
      if (lbl) { lbl.textContent = t("capturingMsg"); lbl.className = ""; }
    }
    else if (msg?.type === "YAD_CLAUDE_BRIDGE_CAPTURING") {
      const el = document.getElementById("claude-capture-msg");
      if (el) { el.textContent = t("claudeCapturingMsg"); el.className = ""; }
    }
    else if (msg?.type === "YAD_CLAUDE_BRIDGE_RESULT") {
      const el = document.getElementById("claude-capture-msg");
      const btn = document.getElementById("claude-capture-btn") as HTMLButtonElement | null;
      if (btn) btn.disabled = false;
      if (el) {
        if (msg.ok) {
          el.textContent = `✓ ${t("bridgeSent")}: ${msg.path ?? "yad-claude-bridge.json"}`;
          el.className = "ok";
        } else {
          el.textContent = `✗ ${msg.detail ?? t("unknownError")}`;
          el.className = "err";
        }
      }
    }
    else if (msg?.type === "YAD_SESSION_RESULT") {
      const captMsgEl = document.getElementById("capture-msg");
      const a = document.getElementById("capture-a") as HTMLButtonElement | null;
      const b = document.getElementById("capture-b") as HTMLButtonElement | null;
      if (a) a.disabled = false;
      if (b) b.disabled = false;
      if (captMsgEl) {
        if (msg.ok) {
          captMsgEl.textContent = `✓ ${msg.brand ?? t("sessionFallbackName")} ${t("sessionCaptured")}: ${msg.authType ?? ""}`;
          captMsgEl.className = "ok";
        } else {
          captMsgEl.textContent = `✗ ${msg.detail ?? t("unknownError")}`;
          captMsgEl.className = "err";
        }
      }
    }
  });
}

// ---- Paginascan: de enige functie die zonder het Brein werkt ----

/**
 * Laat zien welke knoppen en velden Yad op de huidige pagina herkent.
 *
 * Werkt bewust zonder het lokale Brein. Dat heeft twee kanten die allebei echt zijn.
 *
 * Voor de gebruiker: dit is het eerste wat je wilt weten voordat je iets installeert, en
 * het is later het snelste antwoord op "waarom pakt hij die knop niet". Ziet Yad het veld
 * niet, dan hoef je niet verder te zoeken in je opdracht.
 *
 * Voor de winkel: Google verwijdert extensies waarvan het enige doel is een ander
 * programma te starten. Zonder deze knop is Yad precies dat, want de startknop staat uit
 * zolang het Brein niet draait. Dit is geen alibi maar de goedkoopste verzekering die er is,
 * en hij levert de gebruiker ook nog iets op.
 */
async function scanPagina(): Promise<void> {
  const knop = $<HTMLButtonElement>("#scan-btn");
  const uit = $<HTMLElement>("#scan-uitslag");
  uit.classList.remove("hidden");
  knop.disabled = true;
  uit.textContent = t("scanLooking");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url ?? "")) {
      const p = document.createElement("p");
      p.className = "leeg";
      p.textContent = t("scanOnlyWebpage");
      uit.replaceChildren(p);
      return;
    }

    let snap: { nodes?: Array<{ ref: string; role?: string; name?: string }> } | undefined;
    try {
      snap = await chrome.tabs.sendMessage(tab.id, { type: "YAD_SNAPSHOT" }, { frameId: 0 });
    } catch {
      // Het leesscript zit er nog niet in, bijvoorbeeld op een tabblad dat al openstond
      // toen de extensie werd geïnstalleerd. Alsnog injecteren en het opnieuw vragen.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-scripts/content.js"] });
      snap = await chrome.tabs.sendMessage(tab.id, { type: "YAD_SNAPSHOT" }, { frameId: 0 });
    }

    const nodes = snap?.nodes ?? [];
    if (nodes.length === 0) {
      const p = document.createElement("p");
      p.className = "leeg";
      p.textContent = t("scanNoElements");
      uit.replaceChildren(p);
      return;
    }

    const rijen = nodes
      .slice(0, 60)
      .map((n) => {
        const rol = document.createElement("span");
        rol.className = "rol";
        rol.textContent = n.role ?? "?";
        const naam = document.createElement("span");
        naam.className = "naam";
        naam.textContent = n.name && n.name.trim() ? n.name : t("scanNoLabel");
        const rij = document.createElement("div");
        rij.className = "rij";
        rij.append(rol, naam);
        return rij;
      });

    const kop = document.createElement("p");
    kop.className = "kop";
    kop.textContent =
      nodes.length > 60
        ? `${nodes.length} ${t("scanRecognizedFirst60")}`
        : `${nodes.length} ${t("scanRecognized")}`;

    // Met append en textContent in plaats van innerHTML: een pagina mag zelf bepalen wat
    // er in een knoplabel staat, en dat is niets om ongefilterd in ons paneel te zetten.
    uit.replaceChildren(kop, ...rijen);
  } catch (e) {
    const p = document.createElement("p");
    p.className = "leeg";
    p.textContent = `${t("scanReadError")}${String(e).slice(0, 160)}`;
    uit.replaceChildren(p);
  } finally {
    knop.disabled = false;
  }
}

// ---- Init ----

async function init(): Promise<void> {
  $<HTMLButtonElement>("#scan-btn").addEventListener("click", () => void scanPagina());
  if (await isAccepted()) startApp();
  else await showGate();
}

void init();
