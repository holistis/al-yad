/**
 * YAD server-playwright — Standalone HTTP server voor externe /goal requests.
 *
 * Draait op 0.0.0.0:3748 (instelbaar via YAD_SERVER_PORT).
 * Gebruikt Playwright (headless Chromium) — geen Chrome-extensie nodig.
 * LLM: Ollama only (OLLAMA_BASE_URL + YAD_EXTERNAL_OLLAMA_MODEL).
 * Auth: X-API-Key header (YAD_API_KEYS).
 * Rate: 20 req/min per key (via checkExternalGate).
 * Concurrentie: één run tegelijk (mutex), overige requests wachten in wachtrij.
 *
 * Endpoints:
 *   GET  /status  → { ok, version, busy, ollamaConfigured }
 *   POST /goal    → { ok, status, summary, steps }
 *
 * Starten op de server:
 *   OLLAMA_BASE_URL=http://localhost:11434 \
 *   YAD_EXTERNAL_MODE=1 \
 *   YAD_API_KEYS=jouw-geheime-sleutel \
 *   node dist/server-playwright.js
 *
 * Aanroepen als externe client:
 *   curl -X POST http://jouw-server-ip:3748/goal \
 *     -H "X-API-Key: jouw-geheime-sleutel" \
 *     -H "Content-Type: application/json" \
 *     -d '{"goal":"ga naar example.com en lees de titel"}'
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import process from "node:process";
import { loadEnvFile } from "./env.js";
import { buildExternalOllamaPool } from "./engine/pool.js";
import { LlmRouter } from "./engine/router.js";
import { AgentLoop } from "./agent/loop.js";
import { CacheStore } from "./memory/cache-store.js";
import { RunHistoryStore } from "./history/run-history.js";
import { PlaywrightHand } from "./playwright-hand.js";
import { checkExternalGate } from "./external-gate.js";

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
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
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

// ── HTTP server ─────────────────────────────────────────────────────────────
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

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

  // Auth + rate-limit via de bestaande externe poort
  const gate = checkExternalGate(req, url, method);
  if (!gate.allow) {
    json(res, gate.status, gate.body);
    return;
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
