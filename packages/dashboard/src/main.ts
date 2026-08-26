/**
 * dashboard — Orchestrator-UI vóór main-server.ts.
 *
 * main-server.ts (packages/companion) is een kale, blokkerende HTTP-API: POST /goal
 * wacht tot de hele browser-run klaar is en heeft geen eigen geheugen van taken
 * (geen run-IDs, geen geschiedenis, alleen een live concurrency-teller). Dit pakket
 * verandert daar NIETS aan — het is puur een client ervoor: het geeft elke taak een
 * ID, houdt een eigen wachtrij + worker-pool bij (met een concurrency-cap ONDER die
 * van main-server.ts), en biedt een simpele pagina om meerdere taken tegelijk te
 * volgen. main-server.ts blijft een losstaande, ongewijzigde afhankelijkheid.
 *
 * GEBRUIK:
 *   node dist/main.js
 *
 * OMGEVING:
 *   YAD_SERVER_URL       — optioneel, default http://localhost:3747
 *   DASHBOARD_PORT        — optioneel, default 3760
 *   DASHBOARD_HOST         — optioneel, default 127.0.0.1 (NIET 0.0.0.0 als default —
 *                            dit is een lokaal bedienpaneel, geen publieke server)
 *   DASHBOARD_CONCURRENCY — optioneel, default 5 (geklemd op strikt ÓNDER main-server.ts's
 *                           eigen MAX_CONCURRENT=10, zodat de dashboard zelf nooit de
 *                           volledige budget van andere afnemers van die server opsoupeert)
 *   YAD_JOB_TIMEOUT_MS    — optioneel, default 1200000 (20 min). Harde ceiling per job-call
 *                           naar main-server.ts's /goal — zonder dit blijft een hangende
 *                           fetch() een worker-slot voor altijd bezet en loopt de pool bij
 *                           `concurrency` keer volledig vast.
 *
 * ENDPOINTS:
 *   GET  /            → statische dashboard-pagina (form + pollende tabel)
 *   GET  /status       → { ok, activeRunners, concurrency, queueLength, yadServerUrl }
 *   POST /jobs         → { goal, url?, domains?, maxSteps? } -> 201 { id } (niet-blokkerend)
 *   GET  /jobs         → { jobs: Job[] } (nieuwste eerst)
 *   GET  /jobs/:id     → Job | 404
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import process from "node:process";
import { JobStore } from "./job-store.js";
import { WorkerPool } from "./worker-pool.js";
import { PAGE_HTML } from "./page.js";
import {
  validateGoal,
  coerceOptionalUrl,
  coerceOptionalDomains,
  coerceOptionalMaxSteps,
  clampConcurrency,
} from "./validate.js";

const YAD_SERVER_URL = process.env["YAD_SERVER_URL"] ?? "http://localhost:3747";
const PORT = parseInt(process.env["DASHBOARD_PORT"] ?? "3760", 10);
const HOST = process.env["DASHBOARD_HOST"] ?? "127.0.0.1";
const CONCURRENCY = clampConcurrency(parseInt(process.env["DASHBOARD_CONCURRENCY"] ?? "5", 10));

const rawJobTimeout = parseInt(process.env["YAD_JOB_TIMEOUT_MS"] ?? "", 10);
const JOB_TIMEOUT_MS = Number.isFinite(rawJobTimeout) && rawJobTimeout > 0 ? rawJobTimeout : 1_200_000;

// Max. grootte van een request-body (POST /jobs). Ruim genoeg voor goal (max
// 1000 chars) + url + domains + maxSteps, klein genoeg om geen geheugen-DoS
// via een ongeauthenticeerde upload toe te laten.
const MAX_BODY_BYTES = 100 * 1024;

const log = (m: string): void => console.log(`[dashboard] ${m}`);

const store = new JobStore();
const pool = new WorkerPool(store, {
  yadServerUrl: YAD_SERVER_URL,
  concurrency: CONCURRENCY,
  timeoutMs: JOB_TIMEOUT_MS,
  log,
});

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

class BodyTooLargeError extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      // Géén req.destroy() hier: dat sluit de onderliggende socket (req én res
      // delen 'm bij HTTP/1.1), waardoor de 413-respons hieronder nooit meer
      // verstuurd kan worden en de client alleen een connection-reset ziet.
      // In plaats daarvan: stoppen met opbouwen (geheugen blijft begrensd),
      // de rest van de stream laten leeglopen, en normaal antwoorden.
      if (tooLarge) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        body = "";
        reject(new BodyTooLargeError());
        return;
      }
      body += String(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(body);
    });
    req.on("error", reject);
  });
}

// CSRF-afscherming: alleen echte application/json-bodies accepteren. Een
// cross-origin fetch() met Content-Type text/plain of form-urlencoded is een
// browser-"simple request" die zonder CORS-preflight verstuurd wordt — door
// application/json te eisen dwingen we een preflight af, en omdat deze server
// geen Access-Control-Allow-Origin teruggeeft, blokkeert de browser die dan
// zelf al vóór de echte request wordt verstuurd.
function hasJsonContentType(req: IncomingMessage): boolean {
  const raw = req.headers["content-type"];
  if (typeof raw !== "string") return false;
  return raw.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Vangnet: één onverwachte throw ergens in de routing (bv. een niet-afgeschermde
  // parse-fout) mag nooit het hele proces meeslepen — zonder deze try/catch wordt
  // zo'n throw een unhandledRejection en beëindigt Node standaard het proces.
  try {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // --- GET / ---
    if (url === "/" && method === "GET") {
      html(res, 200, PAGE_HTML);
      return;
    }

    // --- GET /status ---
    if (url === "/status" && method === "GET") {
      json(res, 200, {
        ok: true,
        activeRunners: pool.activeRunners,
        concurrency: pool.concurrency,
        queueLength: pool.queueLength,
        yadServerUrl: YAD_SERVER_URL,
      });
      return;
    }

    // --- POST /jobs ---
    if (url === "/jobs" && method === "POST") {
      if (!hasJsonContentType(req)) {
        json(res, 415, { ok: false, detail: "Content-Type moet application/json zijn" });
        return;
      }

      const contentLength = Number(req.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        json(res, 413, { ok: false, detail: `Request-body te groot (max ${MAX_BODY_BYTES} bytes)` });
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        const body = await readBody(req);
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch (e) {
        if (e instanceof BodyTooLargeError) {
          json(res, 413, { ok: false, detail: `Request-body te groot (max ${MAX_BODY_BYTES} bytes)` });
          return;
        }
        json(res, 400, { ok: false, detail: "Ongeldige JSON in request-body" });
        return;
      }

      const goalCheck = validateGoal(parsed["goal"]);
      if (!goalCheck.ok) {
        json(res, 400, { ok: false, detail: goalCheck.detail });
        return;
      }

      const job = store.create({
        goal: goalCheck.goal,
        url: coerceOptionalUrl(parsed["url"]),
        domains: coerceOptionalDomains(parsed["domains"]),
        maxSteps: coerceOptionalMaxSteps(parsed["maxSteps"]),
      });

      json(res, 201, { ok: true, id: job.id });
      pool.pump(); // niet-blokkerend: de worker-pool pakt de job asynchroon op
      return;
    }

    // --- GET /jobs ---
    if (url === "/jobs" && method === "GET") {
      json(res, 200, { ok: true, jobs: store.list() });
      return;
    }

    // --- GET /jobs/:id ---
    if (url.startsWith("/jobs/") && method === "GET") {
      const rawId = url.slice("/jobs/".length).split("?", 1)[0] ?? "";
      let id: string;
      try {
        id = decodeURIComponent(rawId);
      } catch {
        json(res, 400, { ok: false, detail: "Ongeldig taak-id" });
        return;
      }
      const job = store.get(id);
      if (!job) {
        json(res, 404, { ok: false, detail: `Geen taak met id ${id}` });
        return;
      }
      json(res, 200, { ok: true, job });
      return;
    }

    json(res, 404, { ok: false, detail: `Geen route voor ${method} ${url}` });
  } catch (e) {
    log(`Onverwachte fout bij ${req.method ?? "?"} ${req.url ?? "?"}: ${(e as Error).message}`);
    if (!res.headersSent) {
      json(res, 500, { ok: false, detail: "Interne serverfout" });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  log(`Luistert op ${HOST}:${PORT} (orchestreert ${YAD_SERVER_URL}, concurrency=${CONCURRENCY})`);
  log(`Open http://${HOST}:${PORT}/ voor het dashboard`);
});

server.on("error", (e) => {
  log(`Server-fout: ${(e as Error).message}`);
  process.exit(1);
});
