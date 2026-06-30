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
  },
} as const;

type Lang = "nl" | "en";
type TKey = keyof typeof STRINGS.nl;

let currentLanguage: Lang = "nl";
let currentAutonomy: "confirm" | "auto" = "confirm";
let currentSiteDomain = "";
let companionActiveProviders: string[] = [];

function t(k: TKey): string { return STRINGS[currentLanguage][k]; }

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

// ---- Gate ----

function showGate(): void {
  $("#gate").classList.remove("hidden");
  $("#app").classList.add("hidden");
  (document.getElementById("gate-summary") as HTMLElement).textContent = ACCEPT_SUMMARY;
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
    span.textContent = item.text;
    wrap.append(box, span);
    container.append(wrap);
    boxes.push(box);
  }
  const acceptBtn = $<HTMLButtonElement>("#accept");
  const refresh = (): void => { acceptBtn.disabled = !boxes.every((b) => b.checked); };
  boxes.forEach((b) => b.addEventListener("change", refresh));
  refresh();
  acceptBtn.onclick = async (): Promise<void> => { await recordAcceptance(); startApp(); };
  document.querySelectorAll<HTMLAnchorElement>(".docs a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const doc = a.dataset["doc"];
      if (doc) window.open(chrome.runtime.getURL(`legal/${doc}.html`), "_blank");
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

function addLog(status: RunStatus, message: string, step?: number): void {
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
    txt.textContent = message;
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

function renderAttachPreviews(): void {
  const c = document.getElementById("attach-previews") as HTMLElement;
  c.innerHTML = "";
  for (let i = 0; i < pendingAttachments.length; i++) {
    const a = pendingAttachments[i]!;
    const thumb = document.createElement("span");
    thumb.className = "attach-thumb";
    const img = document.createElement("img");
    img.src = a.previewUrl; img.alt = a.name;
    const nm = document.createElement("span");
    nm.textContent = a.name.length > 18 ? a.name.slice(0, 16) + "…" : a.name;
    const rm = document.createElement("button");
    rm.type = "button"; rm.className = "attach-remove"; rm.title = "Verwijder"; rm.textContent = "✕";
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
      name: file.name || "afbeelding.png",
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
    mkCard(t("statsRuns"), String(total), "totaal"),
    mkCard(t("statsSucceeded"), `${successRate}%`, `${succeeded} / ${total}`),
    mkCard(t("statsAvgSteps"), String(avgSteps), "per run"),
    mkCard(t("statsFailed"), String(total - succeeded), "of afgebroken"),
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
}

async function loadSettingsTab(): Promise<void> {
  const settings = await getSettings();
  renderProviderCatalog(settings);
  $<HTMLInputElement>("#s-steps").value = String(settings.maxSteps);
  $<HTMLElement>("#steps-val").textContent = String(settings.maxSteps);
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
  for (const entry of PROVIDER_CATALOG) {
    const config = settings.providers[entry.id] ?? { enabled: false, key: "" };
    c.append(buildProviderCard(entry, config));
  }
}

function buildProviderCard(entry: ProviderCatalogEntry, config: ProviderUserConfig): HTMLElement {
  const card = document.createElement("div");
  card.className = `provider-card${config.enabled ? " active" : ""}`;
  card.dataset["search"] = `${entry.name} ${entry.tagline} ${entry.id}`.toLowerCase();
  const header = document.createElement("div"); header.className = "provider-header";
  const chk = document.createElement("input"); chk.type = "checkbox";
  chk.id = `prov-${entry.id}-enabled`; chk.checked = config.enabled;
  const nameLabel = document.createElement("label"); nameLabel.htmlFor = chk.id;
  nameLabel.className = "provider-name"; nameLabel.textContent = entry.name;
  const badge = document.createElement("span"); badge.className = `provider-badge ${entry.tier}`; badge.textContent = entry.badge;
  header.append(chk, nameLabel, badge);
  // Toon "✓ via companion" als de companion deze provider actief heeft vanuit zijn .env maar de gebruiker er geen sleutel voor heeft ingesteld
  if (companionActiveProviders.includes(entry.id) && !config.enabled) {
    const companionBadge = document.createElement("span");
    companionBadge.className = "provider-badge companion";
    companionBadge.title = "Actief in companion via .env — geen sleutel nodig in de UI";
    companionBadge.textContent = "✓ actief";
    header.append(companionBadge);
  }
  const detail = document.createElement("div"); detail.className = "provider-detail";
  const tagline = document.createElement("div"); tagline.className = "provider-tagline"; tagline.textContent = entry.tagline;
  const meta = document.createElement("div"); meta.className = "provider-meta";
  if (entry.freeLimit) {
    const lim = document.createElement("span"); lim.className = "provider-limit"; lim.textContent = entry.freeLimit; meta.append(lim);
  }
  const stars = document.createElement("span"); stars.className = "provider-stars";
  stars.textContent = "★".repeat(entry.quality) + "☆".repeat(5 - entry.quality);
  const signupBtn = document.createElement("button"); signupBtn.type = "button";
  signupBtn.className = "provider-signup"; signupBtn.textContent = "Aanmelden →";
  signupBtn.onclick = (): void => { window.open(entry.signupUrl, "_blank"); };
  meta.append(stars, signupBtn); detail.append(tagline, meta);
  const fields = document.createElement("div"); fields.className = "provider-fields";
  if (!config.enabled) fields.classList.add("hidden");
  if (entry.requiresKey) fields.append(buildKeyField(`prov-${entry.id}-key`, "API-sleutel", config.key, entry.keyPlaceholder));
  if (entry.supportsModel) fields.append(buildTextField(`prov-${entry.id}-model`, "Model (leeg = standaard)", config.model ?? "", `bv. ${entry.defaultModel}`));
  if (entry.supportsBaseUrl) {
    const defUrl = entry.defaultBaseUrl ?? "";
    fields.append(buildTextField(`prov-${entry.id}-baseUrl`, entry.id === "ollama" ? "Ollama URL" : "Base URL", config.baseUrl ?? defUrl, defUrl));
  }
  if (entry.supportsPrimary) {
    const pDiv = document.createElement("div"); pDiv.className = "field";
    const pLbl = document.createElement("label"); pLbl.className = "field-check";
    const pChk = document.createElement("input"); pChk.type = "checkbox";
    pChk.id = `prov-${entry.id}-primary`; pChk.checked = config.primary ?? false;
    pLbl.append(pChk, document.createTextNode(" Dit model als sterkste EERST gebruiken"));
    pDiv.append(pLbl); fields.append(pDiv);
  }
  chk.onchange = (): void => { card.classList.toggle("active", chk.checked); fields.classList.toggle("hidden", !chk.checked); };
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
  show.className = "secondary small toggle-show"; show.textContent = "Toon";
  show.onclick = (): void => { inp.type = inp.type === "password" ? "text" : "password"; show.textContent = inp.type === "password" ? "Toon" : "Verberg"; };
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
    const config: ProviderUserConfig = {
      enabled: enabledEl.checked,
      key: (document.getElementById(`prov-${entry.id}-key`) as HTMLInputElement | null)?.value.trim() ?? "",
    };
    const model = (document.getElementById(`prov-${entry.id}-model`) as HTMLInputElement | null)?.value.trim();
    if (model) config.model = model;
    const baseUrl = (document.getElementById(`prov-${entry.id}-baseUrl`) as HTMLInputElement | null)?.value.trim();
    if (baseUrl) config.baseUrl = baseUrl;
    const primaryEl = document.getElementById(`prov-${entry.id}-primary`) as HTMLInputElement | null;
    if (primaryEl) config.primary = primaryEl.checked;
    providers[entry.id] = config;
  }
  return { providers, maxSteps: parseInt($<HTMLInputElement>("#s-steps").value, 10) || 15, autonomy: currentAutonomy, language: currentLanguage };
}

// ---- Start button ----

function startBtnClick(): void {
  const goalEl = $<HTMLTextAreaElement>("#goal");
  const goal = goalEl.value.trim();
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
  addLog("plannen", `Taak gestart: ${goal}`);
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

  // Provider search
  $<HTMLInputElement>("#provider-search").addEventListener("input", (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase().trim();
    let visible = 0;
    document.querySelectorAll<HTMLElement>(".provider-card").forEach((c) => {
      const match = q === "" || (c.dataset["search"] ?? "").includes(q);
      c.classList.toggle("hidden", !match);
      if (match) visible++;
    });
    const cat = $<HTMLElement>("#provider-catalog");
    let note = cat.querySelector<HTMLElement>(".no-results");
    if (visible === 0) {
      if (!note) { note = document.createElement("p"); note.className = "no-results"; note.textContent = "Geen aanbieder gevonden."; cat.append(note); }
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
    await saveSettings(settings);
    void chrome.runtime.sendMessage({ type: "YAD_UPDATE_CONFIG" });
    const msg = $<HTMLElement>("#save-msg");
    msg.textContent = t("savedMsg");
    setTimeout(() => { msg.textContent = ""; }, 3000);
  });

  // Attach button
  document.getElementById("attach-btn")?.addEventListener("click", () => {
    document.getElementById("attach-input")?.click();
  });
  document.getElementById("attach-input")?.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) addImageAttachment(file);
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
    else if (msg?.type === "YAD_RUN_UPDATE" && msg.status)
      addLog(msg.status as RunStatus, msg.message ?? "", msg.step);
    else if (msg?.type === "YAD_CONFIRM_REQUEST" && msg.id)
      showConfirm(msg.id, msg.action, msg.reason ?? "Bevestig deze actie");
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
          el.textContent = `✓ Pagina verstuurd → ${msg.path ?? "yad-claude-bridge.json"}`;
          el.className = "ok";
        } else {
          el.textContent = `✗ ${msg.detail ?? "Onbekende fout"}`;
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
          captMsgEl.textContent = `✓ ${msg.brand ?? "Sessie"} account vastgelegd → ${msg.authType ?? ""}`;
          captMsgEl.className = "ok";
        } else {
          captMsgEl.textContent = `✗ ${msg.detail ?? "Onbekende fout"}`;
          captMsgEl.className = "err";
        }
      }
    }
  });
}

// ---- Init ----

async function init(): Promise<void> {
  if (await isAccepted()) startApp();
  else showGate();
}

void init();
