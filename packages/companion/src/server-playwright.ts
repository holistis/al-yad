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

// ── HTTP server ─────────────────────────────────────────────────────────────
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

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
