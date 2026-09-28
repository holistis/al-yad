/**
 * YAD server-playwright — Standalone HTTP server voor externe /goal- en /osint/*-requests.
 *
 * Draait op 0.0.0.0:3748 (instelbaar via YAD_SERVER_PORT).
 * Gebruikt Playwright (headless Chromium) — geen Chrome-extensie nodig.
 * LLM: Ollama only (OLLAMA_BASE_URL + YAD_EXTERNAL_OLLAMA_MODEL), alleen voor /goal.
 * Auth: X-API-Key header, TWEE GESCHEIDEN sleutelpools (sinds de 2026-09-24-audit):
 *   - YAD_API_KEYS       → /status, /goal (geen ingelogde sessie)
 *   - YAD_OSINT_API_KEYS → /osint/status, /osint/import-session, /osint/read-page
 *     (deze route KAN de echte, ingelogde X/Discord-sessie lezen — bewust een andere
 *     sleutel dan /goal, zodat een gelekte /goal-sleutel geen sessietoegang geeft).
 * Rate: 20 req/min per key (via checkExternalGate). /osint/read-page heeft daarnaast
 *   een eigen concurrency-plafond (OSINT_READ_PAGE_MAX_CONCURRENT).
 * Concurrentie: /goal — één run tegelijk (mutex), overige requests wachten in wachtrij.
 *   /osint/read-page — eigen, lichter concurrency-plafond (geen wachtrij, een burst
 *   erboven krijgt gewoon een 429).
 *
 * Endpoints:
 *   GET  /status              → { ok, version, busy, ollamaConfigured }
 *   POST /goal                → { ok, status, summary, steps }
 *   GET  /osint/status        → { ok, sites: [{site, hasSession, cookieCount, hasLocalStorage, importedAt}] }
 *   POST /osint/import-session→ { ok, site, count, localStorageCount } — body: {site, cookies, localStorage?}
 *     (localStorage is optioneel: een plat {sleutel: waarde}-object, beide altijd strings.
 *     Nodig voor sites die hun sessie niet in een cookie bewaren maar in localStorage, zoals
 *     Discord's webclient — cookies alleen volstaan daar niet, zie server-playwright.ts se
 *     eigen commentaar bij de read-page-handler voor de volledige uitleg.)
 *   POST /osint/read-page     → { ok, site, url, title, text } — body: {site, url}
 *
 * Starten op de server:
 *   OLLAMA_BASE_URL=http://localhost:11434 \
 *   YAD_EXTERNAL_MODE=1 \
 *   YAD_API_KEYS=jouw-geheime-sleutel-voor-goal \
 *   YAD_OSINT_API_KEYS=een-ANDERE-geheime-sleutel-voor-osint \
 *   node dist/server-playwright.js
 *
 * Aanroepen als externe client:
 *   curl -X POST http://jouw-server-ip:3748/goal \
 *     -H "X-API-Key: jouw-geheime-sleutel-voor-goal" \
 *     -H "Content-Type: application/json" \
 *     -d '{"goal":"ga naar example.com en lees de titel"}'
 *
 *   curl -X POST http://jouw-server-ip:3748/osint/read-page \
 *     -H "X-API-Key: een-ANDERE-geheime-sleutel-voor-osint" \
 *     -H "Content-Type: application/json" \
 *     -d '{"site":"x.com","url":"https://x.com/notifications"}'
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import process from "node:process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadEnvFile } from "./env.js";
import { buildExternalOllamaPool } from "./engine/pool.js";
import { LlmRouter } from "./engine/router.js";
import { AgentLoop } from "./agent/loop.js";
import { CacheStore } from "./memory/cache-store.js";
import { RunHistoryStore } from "./history/run-history.js";
import { PlaywrightHand } from "./playwright-hand.js";
import { checkExternalGate } from "./external-gate.js";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

loadEnvFile();

// Voor checkExternalGate: dit process draait altijd in externe modus.
// YAD_EXTERNAL_MODE hoeft niet in de .env te staan — we forceren het hier.
if (!process.env["YAD_EXTERNAL_MODE"]) {
  process.env["YAD_EXTERNAL_MODE"] = "1";
}

const PORT = parseInt(process.env["YAD_SERVER_PORT"] ?? "3748", 10);
const log = (m: string): void => console.log(`[yad-server] ${new Date().toISOString()} ${m}`);

// ── Mutex: één Playwright-run tegelijk ─────────────────────────────────────
let busy = false;
const waiters: Array<() => void> = [];

function acquireLock(): Promise<void> {
  return new Promise((resolve) => {
    if (!busy) { busy = true; resolve(); }
    else waiters.push(resolve);
  });
}

function releaseLock(): void {
  const next = waiters.shift();
  if (next) next();
  else busy = false;
}

// ── HTTP helpers ────────────────────────────────────────────────────────────
// MAJLIS AL-MURAQABA-bevinding (2026-09-24): readBody() had geen enkele
// grootte-limiet — een aanvaller met een geldige key kon een multi-GB body
// naar elke POST-route sturen (inclusief /osint/import-session) en het hele,
// gedeelde server-process laten crashen voor er ook maar één validatiecheck
// liep. main-server.ts had dit exacte gat al gefixt (MAX_BODY_BYTES + een
// eigen foutklasse) — hier hetzelfde patroon toegepast.
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB — elke route hier stuurt normaal een paar honderd bytes tot een paar KB.

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        return; // stop met de body op te bouwen, dat is het eigenlijke geheugenrisico
      }
      body += chunk.toString();
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(new BodyTooLargeError(`Request-body groter dan ${MAX_BODY_BYTES} bytes`));
        return;
      }
      resolve(body);
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ── Goal runner ─────────────────────────────────────────────────────────────
async function runGoal(
  goal: string,
  opts: { maxSteps?: number } = {},
): Promise<{ status: string; summary?: string; steps: number }> {
  const pool = buildExternalOllamaPool();
  const router = new LlmRouter(pool, { log: (m) => log(`[llm] ${m}`) });
  const cacheStore = new CacheStore();
  const runHistory = new RunHistoryStore();
  const hand = new PlaywrightHand({ headless: true, log });
  const startedAt = Date.now();

  await hand.init();
  try {
    const loop = new AgentLoop(
      { chat: (req) => router.chat(req) },
      hand,
      {
        log,
        maxSteps: opts.maxSteps ?? 30,
        autonomy: "auto",
        cacheStore,
      },
    );
    const result = await loop.run(goal);
    runHistory.append({
      id: `srv-${Date.now()}`,
      goal,
      status: result.status,
      steps: result.steps,
      summary: result.summary,
      startedAt,
      finishedAt: Date.now(),
    });
    return result;
  } finally {
    await hand.close();
  }
}

// ── Web UI HTML ─────────────────────────────────────────────────────────────
function buildUiHtml(apiKey: string, model: string, busy: boolean): string {
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YAD — Browser Agent</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 2rem 1rem; }
  .card { background: #1a1d27; border: 1px solid #2d3148; border-radius: 12px; padding: 2rem; width: 100%; max-width: 680px; }
  h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; }
  .sub { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }
  label { display: block; font-size: 0.875rem; font-weight: 600; color: #94a3b8; margin-bottom: 0.5rem; }
  textarea { width: 100%; background: #0f1117; border: 1px solid #2d3148; border-radius: 8px; color: #e2e8f0; font-size: 1rem; line-height: 1.5; padding: 0.75rem 1rem; resize: vertical; min-height: 100px; outline: none; }
  textarea:focus { border-color: #6366f1; }
  textarea:disabled { opacity: 0.5; }
  .row { display: flex; gap: 0.75rem; margin-top: 1rem; }
  button { flex: 1; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; padding: 0.75rem; cursor: pointer; transition: background 0.2s; }
  button:hover:not(:disabled) { background: #4f46e5; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .busy-badge { background: #f59e0b22; color: #f59e0b; border: 1px solid #f59e0b44; border-radius: 6px; font-size: 0.75rem; padding: 0.25rem 0.75rem; display: inline-block; margin-bottom: 1rem; }
  .loading { display: none; text-align: center; padding: 2rem 1rem; }
  .loading.show { display: block; }
  .spinner { width: 40px; height: 40px; border: 3px solid #2d3148; border-top-color: #6366f1; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-text { color: #94a3b8; font-size: 0.9rem; line-height: 1.6; }
  .steps-log { margin-top: 1rem; text-align: left; font-size: 0.8rem; color: #64748b; background: #0f1117; border-radius: 6px; padding: 0.75rem; max-height: 120px; overflow-y: auto; }
  .result { display: none; margin-top: 1.5rem; }
  .result.show { display: block; }
  .result-box { background: #0f1117; border: 1px solid #22c55e44; border-radius: 8px; padding: 1rem 1.25rem; color: #86efac; white-space: pre-wrap; word-break: break-word; font-size: 0.9rem; line-height: 1.6; }
  .result-box.error { border-color: #ef444444; color: #fca5a5; }
  .result-label { font-size: 0.75rem; font-weight: 600; color: #22c55e; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
  .result-label.error { color: #ef4444; }
  .history { margin-top: 2rem; }
  .history h2 { font-size: 0.875rem; font-weight: 600; color: #64748b; margin-bottom: 0.75rem; }
  .hist-item { background: #0f1117; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.5rem; font-size: 0.8rem; cursor: pointer; border: 1px solid transparent; }
  .hist-item:hover { border-color: #2d3148; }
  .hist-goal { color: #94a3b8; margin-bottom: 0.25rem; }
  .hist-result { color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { color: #64748b; font-size: 0.75rem; margin-top: 1.5rem; text-align: center; }
</style>
</head>
<body>
<div class="card">
  <h1>YAD Browser Agent</h1>
  <p class="sub">Geef een opdracht — YAD browst het internet voor je</p>
  ${busy ? '<div class="busy-badge">⏳ Server is nu bezig met een andere taak — jouw opdracht komt erna</div>' : ""}
  <form id="form">
    <label for="goal">Wat moet YAD doen?</label>
    <textarea id="goal" name="goal" placeholder="Voorbeeld: Ga naar kvk.nl en zoek het KvK-nummer van Holistis op" rows="4"></textarea>
    <div class="row">
      <button type="submit" id="btn">Starten</button>
    </div>
  </form>
  <div class="loading" id="loading">
    <div class="spinner"></div>
    <div class="loading-text">
      <strong>YAD is aan het browsen...</strong><br>
      Dit duurt gemiddeld 5 tot 10 minuten.<br>
      Sluit dit venster niet.
    </div>
    <div class="steps-log" id="steps"></div>
  </div>
  <div class="result" id="result">
    <div class="result-label" id="result-label">Resultaat</div>
    <div class="result-box" id="result-box"></div>
  </div>
  <div class="history" id="history-section" style="display:none">
    <h2>Eerdere opdrachten</h2>
    <div id="history-list"></div>
  </div>
</div>
<p class="meta">YAD · Model: ${model} · Vragen? Neem contact op via je contactpersoon.</p>
<script>
const KEY = "${apiKey}";
const STEPS_EL = document.getElementById("steps");
const LOADING = document.getElementById("loading");
const RESULT = document.getElementById("result");
const RESULT_BOX = document.getElementById("result-box");
const RESULT_LABEL = document.getElementById("result-label");
const BTN = document.getElementById("btn");
const GOAL = document.getElementById("goal");

function addStep(msg) {
  const line = document.createElement("div");
  line.textContent = "→ " + msg;
  STEPS_EL.appendChild(line);
  STEPS_EL.scrollTop = STEPS_EL.scrollHeight;
}

function saveHistory(goal, summary) {
  const hist = JSON.parse(sessionStorage.getItem("yad-hist") || "[]");
  hist.unshift({ goal, summary, ts: new Date().toLocaleTimeString("nl-NL") });
  sessionStorage.setItem("yad-hist", JSON.stringify(hist.slice(0, 5)));
  renderHistory();
}

function renderHistory() {
  const hist = JSON.parse(sessionStorage.getItem("yad-hist") || "[]");
  const section = document.getElementById("history-section");
  const list = document.getElementById("history-list");
  if (!hist.length) { section.style.display = "none"; return; }
  section.style.display = "block";
  list.innerHTML = hist.map(h =>
    '<div class="hist-item" onclick="document.getElementById(\\'goal\\').value=\\''+h.goal.replace(/'/g,"\\\\'")+'\\'">' +
    '<div class="hist-goal">' + h.goal.slice(0, 80) + (h.goal.length > 80 ? "..." : "") + " <small style=\\"color:#475569\\">" + h.ts + "</small></div>" +
    '<div class="hist-result">' + (h.summary || "(geen samenvatting)").slice(0, 100) + "</div></div>"
  ).join("");
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const goal = GOAL.value.trim();
  if (!goal) return;

  BTN.disabled = true;
  GOAL.disabled = true;
  BTN.textContent = "Bezig...";
  LOADING.classList.add("show");
  RESULT.classList.remove("show");
  STEPS_EL.innerHTML = "";

  addStep("Opdracht verstuurd naar YAD...");
  addStep("Playwright browser wordt gestart...");

  const startTime = Date.now();
  const ticker = setInterval(() => {
    const sec = Math.floor((Date.now() - startTime) / 1000);
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    document.querySelector(".loading-text strong").textContent =
      "YAD is aan het browsen... (" + (min > 0 ? min + "m " : "") + s + "s)";
  }, 1000);

  try {
    const resp = await fetch("/goal", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": KEY },
      body: JSON.stringify({ goal, maxSteps: 20 }),
    });
    clearInterval(ticker);
    const data = await resp.json();

    if (data.ok && data.summary) {
      RESULT_LABEL.textContent = "Resultaat (" + data.steps + " stappen)";
      RESULT_LABEL.className = "result-label";
      RESULT_BOX.className = "result-box";
      RESULT_BOX.textContent = data.summary;
      addStep("Klaar! " + data.steps + " stappen uitgevoerd.");
      saveHistory(goal, data.summary);
    } else if (data.ok && data.status === "fout") {
      RESULT_LABEL.textContent = "Niet gelukt";
      RESULT_LABEL.className = "result-label error";
      RESULT_BOX.className = "result-box error";
      RESULT_BOX.textContent = "YAD kon de opdracht niet voltooien. Probeer de opdracht anders te formuleren of probeer opnieuw.";
      addStep("Run mislukt — probeer opnieuw.");
    } else {
      RESULT_LABEL.textContent = "Fout";
      RESULT_LABEL.className = "result-label error";
      RESULT_BOX.className = "result-box error";
      RESULT_BOX.textContent = data.detail || JSON.stringify(data, null, 2);
      addStep("Serverfout: " + (data.detail || "onbekend"));
    }
  } catch (err) {
    clearInterval(ticker);
    RESULT_LABEL.textContent = "Verbindingsfout";
    RESULT_LABEL.className = "result-label error";
    RESULT_BOX.className = "result-box error";
    RESULT_BOX.textContent = "Kon de server niet bereiken. Controleer of je internet hebt en probeer opnieuw.\\n\\nTechnische fout: " + err.message;
    addStep("Verbindingsfout: " + err.message);
  } finally {
    LOADING.classList.remove("show");
    RESULT.classList.add("show");
    BTN.disabled = false;
    GOAL.disabled = false;
    BTN.textContent = "Starten";
  }
});

renderHistory();
</script>
</body>
</html>`;
}

// ── Young Consult helpers (buiten request handler) ───────────────────────────
const YC_CONFIG_PATH = "/opt/al-yad/recruiter/config.json";
const YC_SESSION_PATH = "/opt/al-yad/recruiter/linkedin-session.json";
const YC_DASHBOARD_PATH = "/opt/al-yad/recruiter/dashboard.html";

function ycReadConfig(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(YC_CONFIG_PATH, "utf8")); } catch { return { presets: [] }; }
}
function ycWriteConfig(cfg: Record<string, unknown>) {
  writeFileSync(YC_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

/**
 * VEILIGHEIDSFIX (2026-08-24): de /yc/*-schrijf-routes stonden zonder enige authenticatie
 * open op 0.0.0.0, publiek bevestigd bereikbaar. Iedereen op het internet kon willekeurige
 * cookies naar linkedin-session.json schrijven (sessie-kaping) of een scan/CRM-login
 * triggeren. Dit dicht dat gat zonder checkExternalGate te hergebruiken (die vereist
 * YAD_EXTERNAL_MODE + een X-API-Key die het dashboard nooit stuurde): een eigen, per-server
 * gegenereerde sleutel, ingebed in de dashboard-HTML (zelfde patroon als de bestaande
 * apiKey-inbedding voor GET /), en verplicht op elke schrijf-actie via X-Yc-Key.
 */
const YC_SECRET_PATH = "/opt/al-yad/recruiter/.yc-dashboard-key";
function ycSecret(): string {
  try {
    const existing = readFileSync(YC_SECRET_PATH, "utf8").trim();
    if (existing) return existing;
  } catch { /* nog niet gegenereerd */ }
  const fresh = randomBytes(24).toString("hex");
  try {
    if (!existsSync("/opt/al-yad/recruiter")) mkdirSync("/opt/al-yad/recruiter", { recursive: true });
    writeFileSync(YC_SECRET_PATH, fresh, "utf8");
  } catch { /* schrijven mislukt: sleutel leeft dan alleen in-memory voor dit proces */ }
  return fresh;
}
function ycAuthorized(req: IncomingMessage): boolean {
  const provided = req.headers["x-yc-key"];
  const key = Array.isArray(provided) ? provided[0] : provided;
  return !!key && key === ycSecret();
}

// ── OSINT sessie-import (generalisatie van /yc/import-session, sinds 2026-09-24) ────
// Zelfde patroon (cookies eenmalig importeren, later server-side hergebruiken zonder
// dat er een mens hoeft in te loggen), maar site-onafhankelijk en achter de AL BESTAANDE,
// geauditeerde externe poort (checkExternalGate/X-API-Key) i.p.v. een nieuw, los geheim
// zoals ycSecret() — minder losse auth-paden om te moeten controleren bij een audit.
// Vaste allowlist i.p.v. een vrij site-veld: voorkomt zowel pad-traversal bij het
// opslaan (site wordt nooit ongecontroleerd in een bestandspad geplakt) als dat iemand
// met een geldige API-key deze route gebruikt om een sessie voor een willekeurige,
// niet-bedoelde site te bewaren.
const OSINT_ALLOWED_SITES: readonly string[] = ["x.com", "discord.com"];
// Overschrijfbaar via env zodat tests een geïsoleerde tijdelijke map kunnen gebruiken
// i.p.v. het echte, gedeelde /opt/al-yad-pad op schijf te raken.
const OSINT_SESSIONS_DIR = process.env["YAD_OSINT_SESSIONS_DIR"] ?? "/opt/al-yad/osint/sessions";

function osintSessionPath(site: string): string {
  return join(OSINT_SESSIONS_DIR, `${site}.json`);
}

/**
 * Eén gedeelde host-vergelijking voor alle OSINT-plekken die moeten checken of een
 * hostname bij een toegestane site hoort (cookie-domain-validatie bij import EN de
 * SSRF-check vóór/na navigatie bij read-page) — bewust hetzelfde stukje logica op
 * één plek, niet drie keer apart geschreven, want twee "gelijke" checks die uit elkaar
 * groeien is precies hoe dit soort validatie-gaten in de praktijk ontstaan.
 */
function osintHostHoortBijSite(host: string, site: string): boolean {
  const bare = host.toLowerCase().replace(/^\./, "").replace(/^www\./, "");
  return bare === site || bare.endsWith(`.${site}`);
}

// MAJLIS AL-MURAQABA-bevinding (2026-09-24): /osint/read-page had GEEN concurrency-
// beperking (anders dan /goal se acquireLock/releaseLock-mutex) — de 20-req/min
// rate-limit in external-gate.ts telt alleen VOLUME, niet gelijktijdigheid, dus een
// korte burst binnen die limiet kon evenveel headless Chromium-instanties tegelijk
// starten. Een lichte, eigen concurrency-teller (geen strikte 1-tegelijk-mutex zoals
// /goal, want gelijktijdig meerdere sites lezen is wel degelijk legitiem gebruik).
const OSINT_READ_PAGE_MAX_CONCURRENT = 3;
let osintReadPageActief = 0;

/**
 * MAJLIS AL-MURAQABA-bevindingen (2026-09-24), allebei hier gefixt:
 * (1) Bestandsrechten — dit bevat ECHTE, werkende X.com/Discord-sessiecookies. Zonder
 *     expliciete mode erft het bestand de proces-umask (meestal 0644 = world-readable
 *     op een gedeelde VPS). auth-token.ts in dit package doet het al goed (mode 0o600 +
 *     een expliciete chmodSync) — dat bewezen patroon hier ook toegepast.
 * (2) Atomiciteit — een directe writeFileSync kan een half geschreven, corrupt bestand
 *     achterlaten als het proces middenin crasht (bv. door de OOM/concurrency-fix
 *     hieronder, of gewoon een volle schijf). Schrijf daarom eerst naar een temp-bestand
 *     in dezelfde map, dan een atomische rename (globale CLAUDE.md, Publicatiepoort
 *     punt 2: "schrijf het nieuwe bestand eerst en atomisch, temp-bestand + rename").
 */
function osintSaveSession(site: string, cookies: Record<string, unknown>[], localStorage?: Record<string, string>): void {
  if (!existsSync(OSINT_SESSIONS_DIR)) mkdirSync(OSINT_SESSIONS_DIR, { recursive: true, mode: 0o700 });
  const finalPath = osintSessionPath(site);
  const tmpPath = `${finalPath}.tmp-${randomBytes(6).toString("hex")}`;
  const payload: Record<string, unknown> = { cookies, importedAt: new Date().toISOString() };
  // Alleen opnemen als er echt iets is: houdt bestaande, cookie-only sessiebestanden (X.com)
  // exact in hun oude vorm, geen loze lege sleutel erbij.
  if (localStorage && Object.keys(localStorage).length > 0) payload["localStorage"] = localStorage;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(tmpPath, finalPath);
}

function osintSessionStatus(): Array<{ site: string; hasSession: boolean; cookieCount: number; hasLocalStorage: boolean; importedAt: string | null }> {
  return OSINT_ALLOWED_SITES.map((site) => {
    const path = osintSessionPath(site);
    if (!existsSync(path)) return { site, hasSession: false, cookieCount: 0, hasLocalStorage: false, importedAt: null };
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as { cookies?: unknown[]; localStorage?: Record<string, string>; importedAt?: string };
      return {
        site,
        hasSession: Array.isArray(data.cookies) && data.cookies.length > 0,
        cookieCount: Array.isArray(data.cookies) ? data.cookies.length : 0,
        hasLocalStorage: !!data.localStorage && Object.keys(data.localStorage).length > 0,
        importedAt: data.importedAt ?? null,
      };
    } catch {
      return { site, hasSession: false, cookieCount: 0, hasLocalStorage: false, importedAt: null };
    }
  });
}

function checkRecentContact(datumMatches: string[] | null): { recentContact: boolean; contactDatum: string | null } {
  if (!datumMatches) return { recentContact: false, contactDatum: null };
  for (const d of datumMatches) {
    // Normaliseer DD-MM-YYYY → YYYY-MM-DD
    const parts = d.split(/[-\/]/);
    let parsed: Date | null = null;
    if (parts.length === 3) {
      const [a, b, c] = parts;
      if (c && c.length === 4) {
        // DD-MM-YYYY
        parsed = new Date(`${c}-${(b ?? "01").padStart(2, "0")}-${(a ?? "01").padStart(2, "0")}`);
      } else if (a && a.length === 4) {
        // YYYY-MM-DD
        parsed = new Date(d);
      } else {
        parsed = new Date(d);
      }
    }
    if (parsed && !isNaN(parsed.getTime())) {
      const maanden = (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24 * 30);
      if (maanden < 2) return { recentContact: true, contactDatum: d };
    }
  }
  return { recentContact: false, contactDatum: null };
}

// ── HTTP server ─────────────────────────────────────────────────────────────
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // CORS voor YC dashboard fetch calls vanuit de browser
  if (url.startsWith("/yc")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  }

  // Web UI: GET / is openbaar (geen API-key nodig voor de pagina zelf).
  // De pagina stuurt vervolgens requests naar /goal met de ingebedde sleutel.
  if ((url === "/" || url === "/ui") && method === "GET") {
    const model = process.env["YAD_EXTERNAL_OLLAMA_MODEL"] ?? "qwen2.5:7b";
    const apiKey = (process.env["YAD_API_KEYS"] ?? "").split(",")[0]?.trim() ?? "";
    const html = buildUiHtml(apiKey, model, busy);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // ── Young Consult /yc/* endpoints (geen API-key vereist — eigen dashboard) ──
  if (url.startsWith("/yc")) {
    if (url === "/yc" && method === "GET") {
      try {
        let html = readFileSync(YC_DASHBOARD_PATH, "utf8");
        // Sleutel inbedden zodat de pagina's eigen fetch-calls hem kunnen meesturen.
        html = html.replace("<head>", `<head>\n<script>window.__YC_KEY__=${JSON.stringify(ycSecret())};</script>`);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(404); res.end("dashboard.html niet gevonden — deploy recruiter/dashboard.html naar /opt/al-yad/recruiter/");
      }
      return;
    }
    if (url === "/yc/status" && method === "GET") {
      const hasSession = existsSync(YC_SESSION_PATH);
      json(res, 200, { ok: true, linkedinSessie: hasSession });
      return;
    }
    if (url === "/yc/config" && method === "GET") {
      const cfg = ycReadConfig();
      json(res, 200, { presets: (cfg["presets"] as unknown[]) ?? [], standaard: cfg["standaard_zoekopdracht"] });
      return;
    }
    if (url === "/yc/preset-save" && method === "POST") {
      if (!ycAuthorized(req)) { json(res, 401, { ok: false, error: "Unauthorized" }); return; }
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const { naam, functietitel, locatie } = body;
      if (!naam || !functietitel || !locatie) { json(res, 400, { ok: false }); return; }
      const cfg = ycReadConfig();
      if (!Array.isArray(cfg["presets"])) cfg["presets"] = [];
      const presets = cfg["presets"] as Record<string, unknown>[];
      const id = (naam as string).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const idx = presets.findIndex((p) => p["id"] === id);
      const preset = { id, naam, functietitel, locatie, ...body };
      if (idx >= 0) presets[idx] = preset; else presets.unshift(preset);
      ycWriteConfig(cfg);
      json(res, 200, { ok: true, preset });
      return;
    }
    if (url === "/yc/preset-delete" && method === "POST") {
      if (!ycAuthorized(req)) { json(res, 401, { ok: false, error: "Unauthorized" }); return; }
      const body = JSON.parse(await readBody(req)) as { id?: string };
      const cfg = ycReadConfig();
      if (Array.isArray(cfg["presets"])) {
        cfg["presets"] = (cfg["presets"] as Record<string, unknown>[]).filter((p) => p["id"] !== body.id);
      }
      ycWriteConfig(cfg);
      json(res, 200, { ok: true });
      return;
    }
    if (url === "/yc/import-session" && method === "POST") {
      if (!ycAuthorized(req)) { json(res, 401, { ok: false, error: "Unauthorized" }); return; }
      try {
        const body = JSON.parse(await readBody(req)) as { cookies?: unknown[] };
        if (!Array.isArray(body.cookies) || body.cookies.length === 0) {
          json(res, 400, { ok: false, detail: "cookies array is leeg" }); return;
        }
        if (!existsSync("/opt/al-yad/recruiter")) mkdirSync("/opt/al-yad/recruiter", { recursive: true });
        writeFileSync(YC_SESSION_PATH, JSON.stringify({ cookies: body.cookies }, null, 2), "utf8");
        json(res, 200, { ok: true, count: body.cookies.length });
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }
    if (url === "/yc/scan" && method === "POST") {
      // Scan wordt hieronder afgehandeld — val door naar het grote scan-blok
    } else {
      json(res, 404, { error: "Onbekend YC-endpoint" });
      return;
    }
  }

  // Auth + rate-limit via de bestaande externe poort (voor /status, /goal, etc.)
  if (!url.startsWith("/yc")) {
    const gate = checkExternalGate(req, url, method);
    if (!gate.allow) {
      json(res, gate.status, gate.body);
      return;
    }
  }

  if (url === "/status" && method === "GET") {
    const pool = buildExternalOllamaPool();
    json(res, 200, {
      ok: true,
      version: "0.1.0",
      busy,
      queued: waiters.length,
      ollamaConfigured: pool.length > 0,
      ollamaUrl: process.env["OLLAMA_BASE_URL"] ?? null,
      model: process.env["YAD_EXTERNAL_OLLAMA_MODEL"] ?? "qwen2.5:7b",
    });
    return;
  }

  if (url === "/goal" && method === "POST") {
    const pool = buildExternalOllamaPool();
    if (pool.length === 0) {
      json(res, 503, { ok: false, detail: "Ollama niet geconfigureerd — stel OLLAMA_BASE_URL in" });
      return;
    }

    let body: { goal?: unknown; maxSteps?: unknown } = {};
    try {
      body = JSON.parse(await readBody(req)) as { goal?: unknown; maxSteps?: unknown };
    } catch {
      json(res, 400, { ok: false, detail: "Ongeldige JSON in request body" });
      return;
    }

    if (typeof body.goal !== "string" || !body.goal.trim()) {
      json(res, 400, { ok: false, detail: "'goal' is verplicht (string)" });
      return;
    }

    const rawGoal = body.goal.slice(0, 1000);
    if (/ignore\s+(previous|all)\s+instructions?|system\s*prompt|reveal\s+(your\s+)?prompt|exfiltrat/i.test(rawGoal)) {
      json(res, 400, { ok: false, detail: "goal bevat een niet-toegestaan patroon" });
      return;
    }

    const maxSteps = typeof body.maxSteps === "number" && body.maxSteps > 0
      ? Math.min(body.maxSteps, 100)
      : 30;

    log(`Goal ontvangen (wachtrij: ${waiters.length}): "${rawGoal.slice(0, 60)}..."`);
    await acquireLock();
    try {
      const result = await runGoal(rawGoal, { maxSteps });
      json(res, 200, { ok: true, ...result });
    } catch (e) {
      log(`Run fout: ${(e as Error).message}`);
      json(res, 500, { ok: false, detail: (e as Error).message });
    } finally {
      releaseLock();
    }
    return;
  }

  // ── OSINT: sessie importeren (eenmalig, door een mens) ──────────────────────
  if (url === "/osint/import-session" && method === "POST") {
    let body: { site?: unknown; cookies?: unknown; localStorage?: unknown } = {};
    try {
      body = JSON.parse(await readBody(req)) as { site?: unknown; cookies?: unknown; localStorage?: unknown };
    } catch (e) {
      if (e instanceof BodyTooLargeError) { json(res, 413, { ok: false, detail: e.message }); return; }
      json(res, 400, { ok: false, detail: "Ongeldige JSON in request body" });
      return;
    }

    const site = typeof body.site === "string" ? body.site.toLowerCase().trim() : "";
    if (!OSINT_ALLOWED_SITES.includes(site)) {
      json(res, 400, { ok: false, detail: `'site' moet een van deze zijn: ${OSINT_ALLOWED_SITES.join(", ")}` });
      return;
    }
    if (!Array.isArray(body.cookies) || body.cookies.length === 0) {
      json(res, 400, { ok: false, detail: "'cookies' moet een niet-lege array zijn" });
      return;
    }
    if (body.cookies.length > 200) {
      json(res, 400, { ok: false, detail: "te veel cookies (max 200) — waarschijnlijk het verkeerde bestand geplakt" });
      return;
    }
    // MAJLIS AL-MURAQABA-bevinding (2026-09-24): de oude check liet een cookie met een
    // 'domain' (of 'url') voor een HEEL ANDER domein gewoon door — die werd dan onder de
    // opgegeven site opgeslagen en bij elke /osint/read-page voor die site stilzwijgend
    // meegeladen in de browsercontext. Nu wordt, ALS domain/url aanwezig is, ook
    // gecontroleerd dat die echt bij de opgegeven site hoort (osintHostHoortBijSite,
    // dezelfde gedeelde check als de SSRF-controle bij /osint/read-page).
    const cookiesGeldig = body.cookies.every((c) => {
      if (!c || typeof c !== "object") return false;
      const rec = c as Record<string, unknown>;
      if (typeof rec["name"] !== "string" || typeof rec["value"] !== "string") return false;
      if (typeof rec["domain"] === "string" && !osintHostHoortBijSite(rec["domain"], site)) return false;
      if (typeof rec["url"] === "string") {
        try {
          if (!osintHostHoortBijSite(new URL(rec["url"]).hostname, site)) return false;
        } catch {
          return false;
        }
      }
      return true;
    });
    if (!cookiesGeldig) {
      json(res, 400, { ok: false, detail: "elke cookie moet minimaal 'name' en 'value' (beide string) hebben, en als 'domain'/'url' aanwezig is moet die bij de opgegeven site horen" });
      return;
    }

    // Optioneel: localStorage, voor sites (Discord) die hun sessie niet in een cookie
    // bewaren. Plat {sleutel: waarde}-object, geen domain/url-metadata nodig (in
    // tegenstelling tot cookies) — localStorage is altijd origin-gebonden aan de site
    // waar dit ONDER geimporteerd wordt, er is geen los "welk domein hoort hierbij"-veld
    // dat verkeerd kan staan.
    let localStorageData: Record<string, string> | undefined;
    if (body.localStorage !== undefined) {
      if (typeof body.localStorage !== "object" || body.localStorage === null || Array.isArray(body.localStorage)) {
        json(res, 400, { ok: false, detail: "'localStorage' moet een plat object zijn (sleutel -> waarde, beide strings)" });
        return;
      }
      const entries = Object.entries(body.localStorage as Record<string, unknown>);
      if (entries.length > 50) {
        json(res, 400, { ok: false, detail: "te veel localStorage-sleutels (max 50) — waarschijnlijk het verkeerde object geplakt" });
        return;
      }
      const allStrings = entries.every(([k, v]) => typeof k === "string" && typeof v === "string");
      if (!allStrings) {
        json(res, 400, { ok: false, detail: "elke localStorage-sleutel/waarde moet een string zijn" });
        return;
      }
      localStorageData = Object.fromEntries(entries as Array<[string, string]>);
    }

    try {
      osintSaveSession(site, body.cookies as Record<string, unknown>[], localStorageData);
      const lsCount = localStorageData ? Object.keys(localStorageData).length : 0;
      log(`OSINT-sessie geïmporteerd voor ${site} (${body.cookies.length} cookies, ${lsCount} localStorage-sleutels)`);
      json(res, 200, { ok: true, site, count: body.cookies.length, localStorageCount: lsCount });
    } catch {
      json(res, 500, { ok: false, detail: "kon sessie niet opslaan op de server" });
    }
    return;
  }

  // ── OSINT: welke sites hebben al een opgeslagen sessie ───────────────────────
  if (url === "/osint/status" && method === "GET") {
    json(res, 200, { ok: true, sites: osintSessionStatus() });
    return;
  }

  // ── OSINT: een pagina lezen met de opgeslagen sessie van de eigen site ──────
  // Bewust ALLEEN lezen (navigeren + tekst/titel teruggeven, zoals de dagelijkse
  // /capture) — geen klikken/typen/posten server-side zonder mens-in-de-lus, dat
  // is een veel groter risico-oppervlak dan we voor dit doel (signalen verzamelen)
  // nodig hebben.
  if (url === "/osint/read-page" && method === "POST") {
    let body: { site?: unknown; url?: unknown } = {};
    try {
      body = JSON.parse(await readBody(req)) as { site?: unknown; url?: unknown };
    } catch (e) {
      if (e instanceof BodyTooLargeError) { json(res, 413, { ok: false, detail: e.message }); return; }
      json(res, 400, { ok: false, detail: "Ongeldige JSON in request body" });
      return;
    }

    const site = typeof body.site === "string" ? body.site.toLowerCase().trim() : "";
    if (!OSINT_ALLOWED_SITES.includes(site)) {
      json(res, 400, { ok: false, detail: `'site' moet een van deze zijn: ${OSINT_ALLOWED_SITES.join(", ")}` });
      return;
    }

    let target: URL;
    try {
      target = new URL(typeof body.url === "string" ? body.url.trim() : "");
    } catch {
      json(res, 400, { ok: false, detail: "'url' is geen geldige URL" });
      return;
    }
    if (target.protocol !== "https:") {
      json(res, 400, { ok: false, detail: "alleen https:// toegestaan" });
      return;
    }
    // SSRF-bescherming: de opgevraagde url moet echt bij de opgegeven site horen.
    // Zonder deze check zou een geldige API-key deze route kunnen misbruiken om
    // MET de opgeslagen sessie-context willekeurige, niet-bedoelde URLs te laten
    // bezoeken door de browser. LET OP: dit toetst alleen de AANVRAAG-url — Chromium
    // volgt redirects, dus de check hieronder wordt na de navigatie HERHAALD tegen
    // de daadwerkelijk bereikte pagina (page.url()), niet alleen hier vooraf.
    if (!osintHostHoortBijSite(target.hostname, site)) {
      json(res, 400, { ok: false, detail: `'url' hoort niet bij site '${site}'` });
      return;
    }
    if (!existsSync(osintSessionPath(site))) {
      json(res, 409, { ok: false, detail: `geen opgeslagen sessie voor '${site}' — importeer eerst via /osint/import-session` });
      return;
    }

    // MAJLIS AL-MURAQABA-bevinding (2026-09-24): geen concurrency-limiet betekende dat
    // een burst binnen de bestaande 20/min-ratelimiet evenveel Chromium-instanties
    // tegelijk kon starten. Vast, laag plafond i.p.v. onbeperkt.
    if (osintReadPageActief >= OSINT_READ_PAGE_MAX_CONCURRENT) {
      json(res, 429, { ok: false, detail: `te veel gelijktijdige /osint/read-page-aanvragen (max ${OSINT_READ_PAGE_MAX_CONCURRENT}), probeer straks opnieuw` });
      return;
    }
    osintReadPageActief++;

    // MAJLIS AL-MURAQABA-bevinding (2026-09-24): chromium.launch() stond eerder BUITEN
    // de try/finally — een falende launch (bv. exact onder de geheugendruk die een
    // concurrency-burst veroorzaakt) gaf dan een ongevangen promise-rejection, en dat
    // crasht op deze Node-versie het HELE, gedeelde companion-process (ook /goal,
    // /status, /yc/*). Nu staat de launch zelf ook binnen try/finally.
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      });
      const ctx = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        viewport: { width: 1366, height: 768 },
        locale: "nl-NL",
        timezoneId: "Europe/Amsterdam",
      });
      const sessionData = JSON.parse(readFileSync(osintSessionPath(site), "utf8")) as { cookies?: unknown[]; localStorage?: Record<string, string> };
      if (Array.isArray(sessionData.cookies) && sessionData.cookies.length > 0) {
        await ctx.addCookies(sessionData.cookies as Parameters<typeof ctx.addCookies>[0]);
      }
      // Sommige sites (Discord's webclient) bewaren hun sessie niet in een cookie maar in
      // localStorage -- context.addCookies() alleen kan die sessie dan principieel niet
      // namaken. addInitScript() draait VOOR elk scriptje van de site zelf, op elke nieuwe
      // pagina in deze context, dus de sessie staat al klaar voordat de site's eigen JS ooit
      // controleert of iemand is ingelogd. Moet VOOR ctx.newPage() staan: addInitScript
      // registreert zich voor toekomstige pagina's in deze context, werkt niet met
      // terugwerkende kracht op een pagina die al bestaat.
      if (sessionData.localStorage && Object.keys(sessionData.localStorage).length > 0) {
        // String-vorm i.p.v. een getypeerde functie (zelfde patroon als de bestaande
        // "verberg automation-fingerprint"-addInitScript verderop in dit bestand): de
        // callback-body draait in de BROWSER, niet in Node, dus TypeScript kent `window`
        // hier niet als die als een echte functie wordt getypt. JSON.stringify escaped elke
        // waarde veilig (aanhalingstekens, backslashes, nieuwe regels), dus dit is ook veilig
        // als een token zelf zulke tekens bevat.
        const localStorageJson = JSON.stringify(sessionData.localStorage);
        await ctx.addInitScript(`
          (function () {
            var data = ${localStorageJson};
            for (var k in data) {
              try { window.localStorage.setItem(k, data[k]); } catch (e) { /* uitzonderlijk geblokkeerd, navigatie mag doorgaan */ }
            }
          })();
        `);
      }
      const page = await ctx.newPage();
      await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Live gemeten (2026-09-28): een kale, vaste 2s-wachttijd volstaat voor sommige pagina's
      // (bv. x.com/notifications) maar niet voor client-side-gerenderde resultatenlijsten
      // (bv. x.com/search) -- die kwamen in twee van twee live tests LEEG terug (alleen de
      // vaste pagina-chrome, geen enkel resultaat). networkidle wacht ADAPTIEF tot de site
      // stopt met data ophalen i.p.v. een gegokt vast getal, met een eigen timeout zodat een
      // pagina die nooit "idle" wordt (long-polling, een streaming-widget) de read-page-call
      // niet onnodig laat mislukken -- valt dan gewoon terug op wat er tegen die tijd al staat.
      try {
        await page.waitForLoadState("networkidle", { timeout: 8000 });
      } catch {
        // Geen probleem: de pagina bleef gewoon actief netwerkverkeer hebben (bv. een
        // achtergrond-poll), we lezen straks gewoon wat er op dat moment staat.
      }
      await page.waitForTimeout(500);

      // MAJLIS AL-MURAQABA-bevinding (2026-09-24): Chromium volgt HTTP- en JS-redirects
      // binnen dezelfde page.goto()-aanroep. Zonder deze hercontrole zou een redirect
      // vanaf een toegestane site (open-redirect, of een interne/metadata-host) de
      // pre-navigatie-host-check volledig omzeilen — de inhoud van de UITEINDELIJKE
      // pagina moet dus opnieuw tegen dezelfde allowlist getoetst worden voor die
      // teruggaat naar de aanvrager.
      const bereikteUrl = new URL(page.url());
      if (!osintHostHoortBijSite(bereikteUrl.hostname, site)) {
        json(res, 502, {
          ok: false,
          detail: `navigatie eindigde op een host ('${bereikteUrl.hostname}') die niet bij site '${site}' hoort — waarschijnlijk een redirect, geweigerd`,
        });
        return;
      }

      const title = await page.title();
      const text = (await page.evaluate("document.body ? document.body.innerText || '' : ''")) as string;
      json(res, 200, { ok: true, site, url: page.url(), title, text: text.slice(0, 20_000) });
    } catch {
      json(res, 500, { ok: false, detail: "kon de pagina niet laden" });
    } finally {
      osintReadPageActief--;
      if (browser) await browser.close();
    }
    return;
  }

  // ── Young Consult scan (POST /yc/scan) ──────────────────────────────────
  if (url === "/yc/scan" && method === "POST") {
    if (!ycAuthorized(req)) { json(res, 401, { ok: false, error: "Unauthorized" }); return; }
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(await readBody(req)) as Record<string, unknown>;
    } catch {
      json(res, 400, { ok: false, detail: "Ongeldige JSON" });
      return;
    }

    const functietitel = String(params["functietitel"] ?? "").trim();
    const locatie = String(params["locatie"] ?? "").trim();
    const maxKandidaten = Math.min(Number(params["max_kandidaten"] ?? 10), 25);
    const afstudeerVan = Number(params["afstudeer_van"] ?? 2019);
    const afstudeerTot = Number(params["afstudeer_tot"] ?? 2025);

    if (!functietitel || !locatie) {
      json(res, 400, { ok: false, detail: "functietitel en locatie zijn verplicht" });
      return;
    }

    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const stuur = (type: string, data: unknown) => {
      try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ }
    };

    const logStuur = (tekst: string) => stuur("log", { tekst });

    // Run scan async, don't await here
    (async () => {
      const cfg = ycReadConfig();
      const eazyLogin = cfg["eazymatch"] as { url?: string; gebruikersnaam?: string; wachtwoord?: string } | undefined;

      stuur("start", { functietitel, locatie });
      logStuur(`=== Young Consult Scan ===`);
      logStuur(`Functie: ${functietitel} | Locatie: ${locatie}`);
      logStuur(`Afstudeerjaar: ${afstudeerVan}–${afstudeerTot} | Max: ${maxKandidaten}`);

      const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      });
      try {
        const ctx = await browser.newContext({
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          viewport: { width: 1366, height: 768 },
          locale: "nl-NL",
          timezoneId: "Europe/Amsterdam",
          extraHTTPHeaders: { "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8" },
        });

        // Verberg automation-fingerprint
        await ctx.addInitScript(`
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3] });
        `);

        // Injecteer LinkedIn-sessie als aanwezig (voor profiel-detail stap)
        let heeftLinkedInSessie = false;
        if (existsSync(YC_SESSION_PATH)) {
          try {
            const sessionData = JSON.parse(readFileSync(YC_SESSION_PATH, "utf8")) as { cookies?: unknown[] };
            if (Array.isArray(sessionData.cookies) && sessionData.cookies.length > 0) {
              await ctx.addCookies(sessionData.cookies as Parameters<typeof ctx.addCookies>[0]);
              logStuur(`LinkedIn-sessie geladen (${sessionData.cookies.length} cookies)`);
              heeftLinkedInSessie = true;
            }
          } catch { logStuur("⚠ LinkedIn-sessie kon niet worden geladen"); }
        } else {
          logStuur("Geen LinkedIn-sessie — zoeken via Google X-ray (werkt ook zonder login)");
        }

        // ── Stap 1: LinkedIn zoeken ─────────────────────────────────────────
        // LinkedIn vereist een ingelogde sessie voor zoekresultaten.
        // Zonder sessie: geef duidelijke instructie en stop.
        logStuur(`\n[1/3] LinkedIn doorzoeken op "${functietitel}" in "${locatie}"...`);

        if (!heeftLinkedInSessie) {
          logStuur("❌ Geen LinkedIn-sessie gevonden.");
          logStuur("   Volg deze stappen om de scanner te activeren:");
          logStuur("   1. Installeer 'Cookie Editor' in Chrome");
          logStuur("   2. Log in op linkedin.com");
          logStuur("   3. Open Cookie Editor → Export (JSON)");
          logStuur("   4. Klik '🔑 Sessie instellen' bovenaan het dashboard");
          logStuur("   5. Plak de cookies en klik Opslaan");
          logStuur("   → Daarna werkt de scan volledig automatisch.");
          stuur("klaar", { exitCode: 1, ok: false, reden: "linkedin_sessie_nodig" });
          return;
        }

        function extractJaarUitTekst(tekst: string): number | null {
          const lowerTekst = tekst.toLowerCase();
          const eduIdx = ["opleiding", "education", "studie", "university", "hogeschool",
            "bachelor", "master", "hbo", "wo", "mbo", "fontys", "avans", "zuyd",
            "tu/e", "tue", "eindhoven", "tilburg", "saxion"].reduce((best, kw) => {
              const idx = lowerTekst.indexOf(kw);
              return (idx >= 0 && (best < 0 || idx < best)) ? idx : best;
            }, -1);
          const zoekTekst = eduIdx >= 0 ? tekst.substring(Math.max(0, eduIdx - 50), eduIdx + 800) : tekst;
          const matches = zoekTekst.match(/\b(20\d{2})\b/g);
          if (!matches) return null;
          const jaren = matches.map(Number).filter(j => j >= 2015 && j <= 2026).sort((a, b) => b - a);
          return jaren.length > 0 ? (jaren[0] ?? null) : null;
        }

        const linkedinPage = await ctx.newPage();
        // Wacht even zodat cookies zijn geladen
        await linkedinPage.waitForTimeout(500);

        // LinkedIn people search met locatie-filter
        const zoekUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(functietitel + " " + locatie)}&origin=GLOBAL_SEARCH_HEADER`;
        try {
          await linkedinPage.goto(zoekUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        } catch {
          logStuur("⚠ Timeout bij LinkedIn-laden — doorgaan met wat geladen is");
        }
        await linkedinPage.waitForTimeout(3500);

        // Check of sessie geldig is
        const huidigeUrl = linkedinPage.url();
        if (huidigeUrl.includes("linkedin.com/login") || huidigeUrl.includes("linkedin.com/authwall") || huidigeUrl.includes("linkedin.com/uas/login")) {
          logStuur("❌ LinkedIn sessie is verlopen.");
          logStuur("   → Importeer nieuwe cookies via het '🔑 Sessie instellen' knopje.");
          stuur("klaar", { exitCode: 1, ok: false, reden: "linkedin_sessie_verlopen" });
          return;
        }

        // Scroll om meer resultaten te laden
        await linkedinPage.evaluate("window.scrollTo(0, 400)");
        await linkedinPage.waitForTimeout(1500);
        await linkedinPage.evaluate("window.scrollTo(0, 900)");
        await linkedinPage.waitForTimeout(1500);

        // Extraheer kandidaten uit zoekresultaten
        const rawKandidatenJson = await linkedinPage.evaluate(`(function(){
          var seen = {}; var results = [];
          // Zoekresultaat-items: elk persoon staat in een li.reusable-search__result-container
          var items = document.querySelectorAll('li.reusable-search__result-container, li[class*="result-container"]');
          if (items.length === 0) {
            // Fallback: alle profiellinks op de pagina
            items = [document.body];
          }
          var anchors = document.querySelectorAll('a[href*="/in/"]');
          for (var i = 0; i < anchors.length; i++) {
            var a = anchors[i]; var href = a.href || '';
            var m = href.match(/linkedin\\.com\\/in\\/([a-zA-Z0-9_-]{3,80})/);
            if (!m) continue;
            var slug = m[1];
            if (slug === 'undefined' || slug.length < 3) continue;
            if (seen[slug]) continue; seen[slug] = true;
            // Naam ophalen: zoek aria-hidden spans (LinkedIn structuur)
            var naam = '';
            var ariaSpans = a.querySelectorAll('span[aria-hidden="true"]');
            if (ariaSpans.length > 0) naam = ariaSpans[0].textContent ? ariaSpans[0].textContent.trim() : '';
            if (!naam) {
              var visibleSpan = a.querySelector('span:not([aria-hidden])');
              naam = visibleSpan ? visibleSpan.textContent ? visibleSpan.textContent.trim() : '' : '';
            }
            if (!naam) naam = a.textContent ? a.textContent.trim().split('\\n')[0].trim() : '';
            naam = naam.replace(/\\s+/g,' ').trim().slice(0,70);
            var woorden = naam.split(' ').filter(function(w){return w.length>1;});
            if (woorden.length < 2 || naam.length > 70) continue;
            if (/^(Connect|Follow|LinkedIn|Premium|Recruiter|Message|Pending|View|Bekijk|Stuur|Volg|Log|Sign|More|Share)/i.test(naam)) continue;
            // Samenvatting (headline/functie)
            var card = a.closest('li, .entity-result');
            var headline = card ? (card.querySelector('.entity-result__primary-subtitle, .entity-result__summary, [class*="subtitle"]') || null) : null;
            var samenvatting = headline ? headline.textContent ? headline.textContent.trim() : '' : '';
            results.push({ naam: naam, url: 'https://www.linkedin.com/in/' + slug, snippet: samenvatting });
          }
          return JSON.stringify(results.slice(0, 30));
        })()`) as string;

        let gevondenKandidaten: { naam: string; url: string; snippet: string }[] = [];
        try { gevondenKandidaten = JSON.parse(rawKandidatenJson); } catch { gevondenKandidaten = []; }

        logStuur(`${gevondenKandidaten.length} profielen gevonden op LinkedIn`);

        if (gevondenKandidaten.length === 0) {
          logStuur("⚠ Geen profielen gevonden. Mogelijke oorzaken:");
          logStuur("  - LinkedIn toont minder resultaten voor deze zoekopdracht");
          logStuur("  - Probeer een bredere functietitel (bv. 'sales' i.p.v. 'sales support medewerker')");
          stuur("klaar", { exitCode: 1, ok: false, reden: "geen_resultaten" });
          return;
        }

        stuur("log", { tekst: `JSON_EVENT:${JSON.stringify({ type: "kandidaten_gevonden", data: { namen: gevondenKandidaten.map(k => k.naam), kandidaten: gevondenKandidaten, totaal: gevondenKandidaten.length } })}` });

        // ── Stap 2: Afstudeerjaar verificatie per profiel ──────────────────
        logStuur(`\n[2/3] Afstudeerjaar controleren per profiel...`);

        const gefilterd: { naam: string; url: string; afstudeerjaar: number | null; snippet: string }[] = [];

        for (const k of gevondenKandidaten.slice(0, maxKandidaten + 8)) {
          // Bezoek LinkedIn-profiel voor afstudeerjaar
          let gevondenJaar: number | null = null;
          try {
            await linkedinPage.goto(k.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
            await linkedinPage.waitForTimeout(2000 + Math.random() * 800);
            const profielUrl = linkedinPage.url();
            if (profielUrl.includes("login") || profielUrl.includes("authwall")) {
              logStuur("⚠ LinkedIn sessie verlopen tijdens scan");
              break;
            }
            await linkedinPage.evaluate("window.scrollTo(0, 600)");
            await linkedinPage.waitForTimeout(600);
            await linkedinPage.evaluate("window.scrollTo(0, 1400)");
            await linkedinPage.waitForTimeout(800);
            const profielTekst = await linkedinPage.evaluate("document.body ? document.body.innerText || '' : ''") as string;
            gevondenJaar = extractJaarUitTekst(profielTekst);
          } catch {
            logStuur(`  ? ${k.naam} — profiel niet geladen, overgeslagen`);
            continue;
          }

          // Jaar-filter
          if (gevondenJaar !== null && (gevondenJaar < afstudeerVan || gevondenJaar > afstudeerTot)) {
            logStuur(`  ✗ ${k.naam} — afgestudeerd ${gevondenJaar} (buiten ${afstudeerVan}–${afstudeerTot})`);
            continue;
          }
          logStuur(`  ✓ ${k.naam} — ${gevondenJaar ? `afgestudeerd ${gevondenJaar}` : "jaar niet gevonden (meegenomen)"}`);
          gefilterd.push({ ...k, afstudeerjaar: gevondenJaar });
          if (gefilterd.length >= maxKandidaten) break;

          // Kleine vertraging tussen profielbezoeken (respectvol, minder kans op rate-limit)
          await linkedinPage.waitForTimeout(1000 + Math.random() * 500);
        }

        logStuur(`${gefilterd.length} kandidaten na jaar-filter`);

        // ── Stap 3: EazyMatch check ─────────────────────────────────────────
        logStuur(`\n[3/3] EazyMatch checken (${gefilterd.length} kandidaten)...`);
        const eazyPage = await ctx.newPage();
        let eazyIngelogd = false;

        if (eazyLogin?.url) {
          try {
            await eazyPage.goto(eazyLogin.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
            await eazyPage.waitForTimeout(3000);

            const heeftLoginForm = await eazyPage.evaluate(`!!(document.querySelector('#loginPassword'))`) as boolean;
            if (heeftLoginForm && eazyLogin.gebruikersnaam && eazyLogin.wachtwoord) {
              logStuur("EazyMatch: inloggen...");
              // EazyMatch heeft vaste ID's: #loginUsername, #loginPassword, #loginSubmitButton
              await eazyPage.locator("#loginUsername").fill(eazyLogin.gebruikersnaam, { timeout: 5000 });
              await eazyPage.waitForTimeout(200);
              await eazyPage.locator("#loginPassword").fill(eazyLogin.wachtwoord, { timeout: 5000 });
              await eazyPage.waitForTimeout(200);
              await eazyPage.locator("#loginSubmitButton").click({ timeout: 5000 });
              await eazyPage.waitForTimeout(5000); // EazyMatch laadt langzaam (ExtJS)
              logStuur(`EazyMatch: ingelogd (url: ${eazyPage.url().slice(0, 70)})`);
            }
            // Check of login geslaagd is
            const nogLoginForm = await eazyPage.evaluate(`!!(document.querySelector('#loginPassword'))`) as boolean;
            eazyIngelogd = !nogLoginForm;
            if (eazyIngelogd) {
              logStuur("EazyMatch: sessie actief ✓");
              await eazyPage.waitForTimeout(2000); // Wacht tot ExtJS-interface geladen is
            } else {
              logStuur("⚠ EazyMatch: login mislukt — kandidaten worden zonder CRM-check gerapporteerd");
            }
          } catch (e) {
            logStuur(`⚠ EazyMatch: fout bij inloggen — ${(e as Error).message.slice(0, 80)}`);
          }
        }

        const rapport: { naam: string; url: string; afstudeerjaar: number | null; eazymatch: { gevonden: boolean; info: string; recentContact?: boolean; contactDatum?: string | null } }[] = [];

        for (let ri = 0; ri < gefilterd.length; ri++) {
          const k = gefilterd[ri]!;
          logStuur(`  [${ri + 1}/${gefilterd.length}] ${k.naam}...`);
          let eazy: { gevonden: boolean; info: string; recentContact?: boolean; contactDatum?: string | null } = {
            gevonden: false,
            info: eazyIngelogd ? "Niet in systeem" : "EazyMatch niet beschikbaar",
          };

          if (eazyIngelogd) {
            try {
              const voornaam = k.naam.split(" ")[0] ?? k.naam;
              const achternaam = k.naam.split(" ").slice(1).join(" ");

              // Helper: zoek in EazyMatch, return het resultaten-panel als tekst
              const zoekInEazy = async (zoekterm: string): Promise<{ panelTekst: string; aantalStr: string }> => {
                await eazyPage.evaluate(`(function(q){
                  var veld = document.querySelector('input[name="mainSearchField"]') ||
                             document.querySelector('input[class*="x-form-search"]');
                  if(!veld) return;
                  var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
                  if(ns && ns.set) ns.set.call(veld, q);
                  veld.dispatchEvent(new Event('input',{bubbles:true}));
                  veld.dispatchEvent(new Event('change',{bubbles:true}));
                })(${JSON.stringify(zoekterm)})`);
                await eazyPage.waitForTimeout(300);
                await eazyPage.evaluate(`(function(){
                  var t = document.querySelector('.x-form-search-trigger,.x-btn-icon-search');
                  if(t){ t.click(); return; }
                  var v = document.querySelector('input[name="mainSearchField"]');
                  if(v) v.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',keyCode:13}));
                })()`);
                await eazyPage.waitForTimeout(3500);
                // Haal het resultaten-panel op (bevat "geen filter|kandidaten|bestanden")
                const panelData = await eazyPage.evaluate(`(function(){
                  var panels = document.querySelectorAll('.x-panel-body');
                  for(var i=0;i<panels.length;i++){
                    var t = panels[i].innerText;
                    if(t.includes('geen filter') && t.includes('kandidaten') && t.includes('bestanden'))
                      return { panelTekst: t.slice(0,12000), aantalStr: '' };
                  }
                  // Fallback: kijk naar telling-element
                  var tell = document.querySelector('[class*=paging],[class*=toolbar]');
                  return { panelTekst: document.body.innerText.slice(0,8000), aantalStr: tell ? tell.innerText : '' };
                })()`) as { panelTekst: string; aantalStr: string };
                // Haal ook de "Getoond X - Y van Z" tekst op
                const aantalEl = await eazyPage.evaluate(`(function(){
                  var all = document.querySelectorAll('*');
                  for(var i=0;i<all.length;i++){
                    if(all[i].children.length===0 && /Getoond\\s+\\d+/.test(all[i].textContent))
                      return all[i].textContent.trim();
                  }
                  return '';
                })()`) as string;
                return { panelTekst: panelData.panelTekst, aantalStr: aantalEl };
              };

              // Zoek op volledige naam
              let eazyData = await zoekInEazy(k.naam);
              let zoekbasis = "volledige naam";

              const nulResult = (t: string) => /geen gegevens|0 - 0 van 0/i.test(t) || (!t.includes(k.naam) && !t.includes(voornaam));
              const heeftResult = (d: { panelTekst: string; aantalStr: string }) =>
                /Getoond\s+\d/i.test(d.aantalStr) && !nulResult(d.panelTekst);

              // Fallback op voornaam
              if (!heeftResult(eazyData) && achternaam.length > 2) {
                eazyData = await zoekInEazy(voornaam);
                zoekbasis = "voornaam";
              }

              if (!heeftResult(eazyData)) {
                eazy = { gevonden: false, info: "Niet in systeem" };
              } else {
                // Extraheer kandidaatinfo uit het panel
                const panelTekst = eazyData.panelTekst;
                const naamLower = k.naam.toLowerCase();
                const voornaamLower = voornaam.toLowerCase();
                let startIdx = panelTekst.toLowerCase().indexOf(naamLower);
                if (startIdx < 0) startIdx = panelTekst.toLowerCase().indexOf(voornaamLower);

                const kandidaatBlok = startIdx >= 0
                  ? panelTekst.substring(startIdx, startIdx + 600).replace(/\n{3,}/g, "\n").trim()
                  : panelTekst.substring(0, 400).trim();

                // Datum check: "beschikbaar: ja, van DD-MM-YYYY" of andere datum in blok
                const datumMatches = kandidaatBlok.match(/\b(\d{1,2}[-\/]\d{1,2}[-\/](?:20)?\d{2})\b/g);
                const { recentContact, contactDatum } = checkRecentContact(datumMatches);
                if (recentContact) {
                  logStuur(`  ⏭ ${k.naam} — recent contact (${contactDatum}), overgeslagen`);
                  continue;
                }

                // Bouw een leesbaar uittreksel
                const uittreksel = kandidaatBlok.slice(0, 400).replace(/\t/g, " ").trim();
                eazy = { gevonden: true, info: uittreksel, recentContact: false, contactDatum };
              }
            } catch {
              eazy = { gevonden: false, info: "EazyMatch fout" };
            }
            await eazyPage.waitForTimeout(700);
          }

          rapport.push({ naam: k.naam, url: k.url, afstudeerjaar: k.afstudeerjaar, eazymatch: eazy });
          stuur("log", { tekst: `JSON_EVENT:${JSON.stringify({ type: "kandidaat_klaar", data: { naam: k.naam, url: k.url, afstudeerjaar: k.afstudeerjaar, index: rapport.length - 1, eazymatch: eazy } })}` });
          logStuur(`  ✓ ${k.naam} — ${eazy.gevonden ? "in EazyMatch" : "NIEUW"}`);
        }

        const inSysteem = rapport.filter(r => r.eazymatch.gevonden).length;
        logStuur(`\n========================================`);
        logStuur(`Scan klaar. ${rapport.length} kandidaten gevonden.`);
        logStuur(`  Nieuw: ${rapport.length - inSysteem} | Al in EazyMatch: ${inSysteem}`);
        stuur("log", { tekst: `JSON_EVENT:${JSON.stringify({ type: "scan_klaar", data: { totaal: rapport.length, nieuw: rapport.length - inSysteem, inSysteem } })}` });
        stuur("klaar", { exitCode: 0, ok: true });
      } catch (e) {
        logStuur(`Scan fout: ${(e as Error).message}`);
        stuur("klaar", { exitCode: 1, ok: false });
      } finally {
        await browser.close();
      }
    })().catch((e) => { try { logStuur("Onverwachte fout: " + (e as Error).message); stuur("klaar", { exitCode: 1, ok: false }); res.end(); } catch {} });
    return;
  }

  json(res, 404, { error: "Niet gevonden", endpoints: ["GET /status", "POST /goal"] });
});

server.listen(PORT, "0.0.0.0", () => {
  log(`YAD Playwright-server actief op 0.0.0.0:${PORT}`);
  log(`Ollama: ${process.env["OLLAMA_BASE_URL"] ?? "NIET GECONFIGUREERD"}`);
  log(`Model:  ${process.env["YAD_EXTERNAL_OLLAMA_MODEL"] ?? "qwen2.5:7b (default)"}`);
  log(`Auth:   ${process.env["YAD_API_KEYS"] ? "API-keys aanwezig" : "GEEN API-KEYS — alle requests geblokkeerd"}`);
});

server.on("error", (e: Error & { code?: string }) => {
  if (e.code === "EADDRINUSE") {
    log(`FOUT: poort ${PORT} al in gebruik — stel YAD_SERVER_PORT in op een vrij poortnummer`);
  } else {
    log(`Server fout: ${e.message}`);
  }
  process.exit(1);
});
