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
 *   YAD_HOST          — optioneel, default 127.0.0.1 (alleen lokaal). Zet dit
 *                       bewust op 0.0.0.0 om van buiten bereikbaar te zijn —
 *                       verkeer dat dan niet van localhost komt loopt door
 *                       dezelfde externe poort als http-api.ts (zie hieronder).
 *   YAD_CDP_ENDPOINT  — optioneel, bv. http://127.0.0.1:9222. Indien gezet:
 *                       verbindt elke run met een AL DRAAIENDE, echte Chrome
 *                       (gestart met --remote-debugging-port op een NIET-
 *                       standaardprofiel — zie playwright-hand.ts) i.p.v. een
 *                       lege Chromium te starten, zodat de run de echte,
 *                       ingelogde sessie van de gebruiker heeft (en, via
 *                       PlaywrightHand's frame-bewuste snapshot/act, ook
 *                       cross-origin iframes bereikt). Elke run opent nog
 *                       steeds een eigen, nieuw tabblad en sluit alleen dat
 *                       tabblad, nooit de browser zelf. WEIGERT te starten
 *                       in combinatie met YAD_EXTERNAL_MODE=1: de echte,
 *                       persoonlijke browsersessie van de gebruiker mag nooit
 *                       ook nog bereikbaar zijn voor extern/API-key-verkeer.
 *
 * ENDPOINTS:
 *   GET  /status    → { ok, mode, version }
 *   POST /goal      → { ok, status, steps, summary }
 *                     Body: { goal, url?, domains?, maxSteps?, sync? }
 *
 * BEVEILIGING:
 *   - Standaard bindt aan 127.0.0.1, niet bereikbaar van buiten tenzij YAD_HOST
 *     expliciet anders gezet wordt.
 *   - Niet-lokaal verkeer (of een DNS-rebinding-poging die lokaal lijkt maar een
 *     valse Host-header heeft) loopt door checkExternalGate() uit external-gate.ts:
 *     standaard 403, en pas open met YAD_EXTERNAL_MODE=1 + YAD_API_KEYS
 *     (X-API-Key-header, endpoint-allowlist /status+/goal, 20 req/min rate-limit,
 *     audit-log). Zelfde poort als http-api.ts, geen los, ongeteste mechanisme.
 *   - Auth-token (X-Yad-Token-header, zie auth-token.ts): VERPLICHT voor elk endpoint
 *     behalve GET /status, ook voor "lokaal" verkeer — anders kan elke andere pagina
 *     die toevallig open staat in dezelfde browser gewoon fetch() naar deze poort doen.
 *     Zelfde mechanisme en tokenbestand als http-api.ts (2026-09-15 hierheen
 *     gebracht, was hier eerder afwezig).
 *   - Concurrency-limiet: 10 gelijktijdige runs max (daarboven 429). Dit is GEEN
 *     tijdvenster-rate-limit op zichzelf — die zit in checkExternalGate() voor
 *     niet-lokaal verkeer.
 *   - Request-body: max 10 MB, grotere bodies worden tijdens het lezen afgebroken (413).
 *   - Goal wordt gesaniteerd (max 1000 chars, inject-patronen geblokkeerd)
 *   - ScopeGuard blokkeert acties buiten de toewijzingsdomeinen
 *   - Harde deny-lijst (/payment, /checkout, ...) altijd actief
 *   - Elke request maakt een eigen browser-instantie (geïsoleerd, auto-sluit) —
 *     of, met YAD_CDP_ENDPOINT, een eigen NIEUW TABBLAD op een gedeelde, echte
 *     browser (nog steeds per-request geïsoleerd wat betreft het tabblad, maar
 *     wel gedeelde login-staat over requests heen — zie YAD_CDP_ENDPOINT hierboven)
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
import { checkExternalGate } from "./external-gate.js";
import { tokenFilePath, loadOrCreateAuthToken, hasValidToken } from "./auth-token.js";
import type { Assignment } from "./gate/assignment.js";

loadEnvFile();

const PORT = parseInt(process.env["YAD_PORT"] ?? "3747", 10);
const HOST = process.env["YAD_HOST"] ?? "127.0.0.1";
const CDP_ENDPOINT = process.env["YAD_CDP_ENDPOINT"] || undefined;
const VERSION = "server-1.0";

if (CDP_ENDPOINT && process.env["YAD_EXTERNAL_MODE"] === "1") {
  // Harde weigering, geen waarschuwing: dit zou de echte, persoonlijke browsersessie
  // van de gebruiker bereikbaar maken voor elk verzoek met een geldige API-key. De
  // twee losse env-vars kunnen elk voor zich veilig zijn; de combinatie niet.
  console.error(
    "[yad-server] FATAAL: YAD_CDP_ENDPOINT en YAD_EXTERNAL_MODE=1 mogen nooit samen aan staan " +
      "(dat zou de echte, ingelogde browsersessie van de gebruiker extern bereikbaar maken). Stop.",
  );
  process.exit(1);
}

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

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB — een goal-body is normaal een paar honderd bytes.

class BodyTooLargeError extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let tooLarge = false;
    // Bij overschrijding stoppen we met het body-buffer te laten groeien (dat is het
    // eigenlijke geheugenrisico), maar we breken de socket niet af — anders komt de
    // 413-foutmelding hieronder nooit meer bij de client aan.
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      body += String(chunk);
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

/** Zelfde DNS-rebinding-check als http-api.ts: TCP-verbinding kan lokaal lijken
 *  terwijl een kwaadwillige pagina in de browser van de gebruiker het verzoek op
 *  afstand initieerde. Alleen een Host-header die exact op deze host:port wijst
 *  telt als "echt lokaal". */
function hasValidHostHeader(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  return host === `localhost:${PORT}` || host === `127.0.0.1:${PORT}`;
}

const authToken = loadOrCreateAuthToken(log);

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  const remoteAddr = req.socket.remoteAddress;
  const isLocalhost = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
  if (isLocalhost && !hasValidHostHeader(req)) {
    json(res, 403, { ok: false, detail: "Ongeldige Host-header — verzoek geweigerd" });
    return;
  }
  if (!isLocalhost) {
    const gate = checkExternalGate(req, url, method);
    if (!gate.allow) {
      json(res, gate.status, gate.body);
      return;
    }
  }

  // Auth-token: een geldig loopback-adres + Host-header bewijst alleen dat het TCP-pakket
  // van deze machine komt, niet WIE het stuurde. Zonder dit kon ELKE andere pagina die de
  // gebruiker toevallig open heeft staan (of elk ander lokaal proces) een fetch() naar deze
  // poort sturen en /goal laten uitvoeren — met YAD_CDP_ENDPOINT actief zou dat de ECHTE,
  // ingelogde browsersessie van de gebruiker zijn (bank, e-mail, crypto-wallet, etc.), niet
  // langer een onschuldige, wegwerpbare Chromium. Ontdekt bij de adversariele security-audit
  // van 2026-09-15, exact het gat dat http-api.ts al in 2026-09-11 dichtte, hier gemist
  // omdat main-server.ts een apart, zustereerd entry-point is. GET /status blijft open (geen
  // enkele actie, alleen "leeft hij").
  const isStatusCheck = url === "/status" && method === "GET";
  if (!isStatusCheck && !hasValidToken(req, authToken)) {
    json(res, 401, {
      ok: false,
      detail: `Ongeldig of ontbrekend token. Stuur header X-Yad-Token met de inhoud van ${tokenFilePath()}.`,
    });
    return;
  }

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
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        json(res, 413, { ok: false, detail: e.message });
        return;
      }
      json(res, 400, { ok: false, detail: "Ongeldige JSON in request-body" });
      return;
    }

    const rawGoal = typeof parsed["goal"] === "string" ? parsed["goal"].slice(0, 1000) : null;
    if (!rawGoal?.trim()) {
      json(res, 400, { ok: false, detail: "Veld 'goal' is verplicht en mag niet leeg zijn" });
      return;
    }

    // Screent alleen de DOOR DE AANROEPER GETYPTE goal-tekst, GEEN algemene
    // prompt-injectie-verdediging (adversariele review 2026-09-11, finding 15):
    // paginatekst die later in hetzelfde prompt terechtkomt wordt hier niet
    // gefilterd, dat gebeurt via de UNTRUSTED PAGE CONTENT-markering in prompt.ts.
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
    const hand = new PlaywrightHand({
      headless: true,
      log: (m) => log(`[hand] ${m}`),
      ...(CDP_ENDPOINT ? { cdpEndpoint: CDP_ENDPOINT } : {}),
    });

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
