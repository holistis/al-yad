/**
 * main-server — Standalone HTTP server voor YAD zonder Chrome extensie.
 *
 * Draait Playwright (headless Chromium) als browser-backend.
 * Geen Chrome extensie, geen native messaging. Puur server-side.
 *
 * GEBRUIK:
 *   node dist/main-server.js
 *
 * OMGEVING:
 *   OLLAMA_BASE_URL   — verplicht, bv. http://localhost:11434
 *   OLLAMA_MODEL      — optioneel, default qwen2.5:7b
 *   YAD_PORT          — optioneel, default 3747
 *   YAD_HOST          — optioneel, default 0.0.0.0 (bereikbaar van buiten)
 *
 * ENDPOINTS:
 *   GET  /status    → { ok, mode, version }
 *   POST /goal      → { ok, status, steps, summary }
 *                     Body: { goal, url?, domains?, maxSteps?, sync? }
 *
 * BEVEILIGING:
 *   - Rate-limit: 10 gelijktijdige runs max (daarboven 429)
 *   - Goal wordt gesaniteerd (max 1000 chars, inject-patronen geblokkeerd)
 *   - ScopeGuard blokkeert acties buiten de toewijzingsdomeinen
 *   - Harde deny-lijst (/payment, /checkout, ...) altijd actief
 *   - Elke request maakt een eigen browser-instantie (geïsoleerd, auto-sluit)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import process from "node:process";
import { loadEnvFile } from "./env.js";
import { buildPool } from "./engine/pool.js";
import { LlmRouter } from "./engine/router.js";
import { AgentLoop } from "./agent/loop.js";
import { CacheStore } from "./memory/cache-store.js";
import { PlaywrightHand } from "./playwright-hand.js";
import { ScopeGuard } from "./gate/scope-guard.js";
import type { Assignment } from "./gate/assignment.js";

loadEnvFile();

const PORT = parseInt(process.env["YAD_PORT"] ?? "3747", 10);
const HOST = process.env["YAD_HOST"] ?? "0.0.0.0";
const VERSION = "server-1.0";

const log = (m: string): void => console.log(`[yad-server] ${m}`);

// Eén gedeeld LLM-pool (bouwt uit OLLAMA_BASE_URL + evt. API-keys in env)
const pool = buildPool();
const router = new LlmRouter(pool, { log: (m) => log(`[llm] ${m}`) });
log(`LLM-pool: ${pool.map((p) => p.name).join(", ")} (${pool.length} providers)`);

// Eenvoudige concurrency-limiet (geen externe dep nodig)
let activeRuns = 0;
const MAX_CONCURRENT = 10;

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += String(chunk); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // --- GET /status ---
  if (url === "/status" && method === "GET") {
    json(res, 200, {
      ok: true,
      mode: "playwright",
      version: VERSION,
      activeRuns,
      maxConcurrent: MAX_CONCURRENT,
      providers: pool.map((p) => p.name),
    });
    return;
  }

  // --- POST /goal ---
  if (url === "/goal" && method === "POST") {
    if (activeRuns >= MAX_CONCURRENT) {
      json(res, 429, { ok: false, detail: `Te veel gelijktijdige runs (max ${MAX_CONCURRENT})` });
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      const body = await readBody(req);
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      json(res, 400, { ok: false, detail: "Ongeldige JSON in request-body" });
      return;
    }

    const rawGoal = typeof parsed["goal"] === "string" ? parsed["goal"].slice(0, 1000) : null;
    if (!rawGoal?.trim()) {
      json(res, 400, { ok: false, detail: "Veld 'goal' is verplicht en mag niet leeg zijn" });
      return;
    }

    // Prompt-injectie blokkeren
    if (/ignore\s+(previous|all)\s+instructions?|system\s*prompt|reveal\s+(your\s+)?prompt|exfiltrat/i.test(rawGoal)) {
      json(res, 400, { ok: false, detail: "Goal bevat een niet-toegestaan patroon" });
      return;
    }

    // Domeinen afleiden: expliciet meegegeven, of afgeleid van url
    const startUrl = typeof parsed["url"] === "string" ? parsed["url"] : undefined;
    let domains: string[] = Array.isArray(parsed["domains"])
      ? (parsed["domains"] as string[]).filter((d) => typeof d === "string")
      : [];

    if (!domains.length && startUrl) {
      try { domains = [new URL(startUrl).hostname]; } catch { /* ongeldig URL */ }
    }

    if (!domains.length) {
      json(res, 400, { ok: false, detail: "Geef 'domains' op of een 'url' waaruit het domein afgeleid kan worden" });
      return;
    }

    const maxSteps = typeof parsed["maxSteps"] === "number" ? parsed["maxSteps"] : 30;

    const assignment: Assignment = {
      id: `srv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      description: rawGoal.slice(0, 80),
      goal: rawGoal,
      targetDomains: domains,
      maxActions: Math.min(maxSteps, 100),
      signedBy: "king",
      createdAt: Date.now(),
    };

    activeRuns++;
    const hand = new PlaywrightHand({ headless: true, log: (m) => log(`[hand] ${m}`) });

    try {
      await hand.init();
      const guard = new ScopeGuard(hand, assignment, (m) => log(`[guard] ${m}`));
      const cache = new CacheStore();

      const loop = new AgentLoop(
        { chat: (req) => router.chat(req) },
        guard,
        {
          log: (m) => log(`[loop] ${m}`),
          maxSteps: assignment.maxActions,
          autonomy: "auto",
          cacheStore: cache,
          isAborted: () => guard.violated,
          pacingMs: 500,
        },
      );

      if (startUrl) {
        await hand.act({ kind: "navigate", url: startUrl });
      }

      const result = await loop.run(rawGoal);

      json(res, 200, {
        ok: true,
        status: guard.violated ? "scope-violation" : result.status,
        steps: result.steps,
        summary: result.summary ?? null,
        stuckSignal: result.stuckSignalId ?? null,
      });
    } catch (e) {
      log(`Fout tijdens run: ${(e as Error).message}`);
      json(res, 500, { ok: false, detail: (e as Error).message });
    } finally {
      await hand.close().catch(() => {});
      activeRuns--;
    }
    return;
  }

  json(res, 404, { ok: false, detail: `Geen route voor ${method} ${url}` });
});

server.listen(PORT, HOST, () => {
  log(`Luistert op ${HOST}:${PORT} (Playwright-modus, ${pool.length} LLM-providers)`);
  log(`Test: curl http://localhost:${PORT}/status`);
});

server.on("error", (e) => {
  log(`Server-fout: ${(e as Error).message}`);
  process.exit(1);
});
