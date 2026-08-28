/**
 * desktop-app — lokale server + UI-schil voor "YAD openen als een gewoon
 * programma": geen Chrome-extensie nodig, geen losse CLI-commando's, gewoon
 * dubbelklikken (via launch.bat) en een venster.
 *
 * Hergebruikt exact dezelfde motor als main-server.ts/main-playwright.ts
 * (packages/companion): PlaywrightHand + AgentLoop + LlmRouter + buildPool
 * (zie runner.ts). Draait de automatiseringsbrowser HEADED (zichtbaar)
 * i.p.v. headless — dit is een bureaublad-app, de gebruiker mag toekijken.
 *
 * v1 = ÉÉN run tegelijk (geen wachtrij zoals packages/dashboard — dat is een
 * ander product voor een ander gebruik: meerdere taken parallel volgen. Dit
 * is het single-focus bureaublad-programma).
 *
 * GEBRUIK:
 *   node dist/main.js
 *   (of dubbelklik launch.bat — die start dit én opent het app-venster)
 *
 * OMGEVING:
 *   YAD_DESKTOP_PORT      — optioneel, default 3761
 *   YAD_DESKTOP_HOST      — optioneel, default 127.0.0.1 (bewust lokaal: dit
 *                            is een persoonlijk bureaublad-programma, geen
 *                            netwerkdienst — vergelijk main-server.ts's
 *                            0.0.0.0-default, dat IS bedoeld als netwerkdienst)
 *   YAD_DESKTOP_HEADLESS  — optioneel, "1"/"true" = headless. Default: headed.
 *
 * ENDPOINTS:
 *   GET  /            → de UI (zelfstandige single-page HTML)
 *   POST /run         → { goal, url?, domains?, maxSteps? } -> 202 (start,
 *                        niet-blokkerend), 409 als er al een run loopt
 *   GET  /run/status  → live status van de huidige/laatste run
 *
 * LEVENSCYCLUS: het Chrome-UI-venster (launch.ts) en dit serverproces zijn
 * losse OS-processen zonder IPC — sluiten van het venster raakt deze server
 * niet rechtstreeks. In plaats daarvan pollt page.ts /run/status elke 1200ms
 * zolang het venster open is; blijft die poll >30s uit, dan neemt de
 * idle-wachter hieronder aan dat het venster dicht is: een lopende run wordt
 * netjes afgebroken (niet onbeheerd verder gedraaid), en zonder actieve run
 * stopt de server zichzelf. Een server die nog nooit gepolld is (het
 * standalone "node dist/main.js"-gebruik uit README.md) sluit zichzelf nooit.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import process from "node:process";
import { loadEnvFile } from "@yad/companion/dist/env.js";
import { PAGE_HTML } from "./page.js";
import { RunState } from "./run-state.js";
import { runGoal } from "./runner.js";
import {
  validateGoal,
  coerceOptionalUrl,
  coerceOptionalDomains,
  coerceOptionalMaxSteps,
} from "./validate.js";

loadEnvFile();

const PORT = parseInt(process.env["YAD_DESKTOP_PORT"] ?? "3761", 10);
const HOST = process.env["YAD_DESKTOP_HOST"] ?? "127.0.0.1";

// Max. grootte van een request-body (POST /run). Ruim genoeg voor goal (max
// 1000 chars) + url + domains + maxSteps, klein genoeg om geen geheugen-DoS
// via een ongeauthenticeerde upload toe te laten. Zelfde grens als
// packages/dashboard/src/main.ts.
const MAX_BODY_BYTES = 100 * 1024;

const log = (m: string): void => console.log(`[desktop-app] ${m}`);

const state = new RunState();

// --- Idle-wachter: sluit het gat dat het sluiten van het app-venster tot nu
// toe geen enkel code-pad raakte (geen IPC tussen het losse Chrome-UI-venster
// en deze server, zie launch.ts's docblock). We gebruiken het UITBLIJVEN van
// page.ts's polling (elke 1200ms zolang het venster open is) als proxy voor
// "venster is dicht":
//   - loopt er een run, dan vraagt requestAbort() 'm netjes te stoppen i.p.v.
//     onbeheerd door te draaien tot maxActions (AgentLoop heeft dit pad al
//     kant-en-klaar, zie runner.ts's isAborted-comment).
//   - loopt er geen run, dan stopt de server zelf — "sluit het venster" voelt
//     dan aan als een gewoon programma afsluiten, in plaats van voor altijd
//     een achtergrond-node.exe achter te laten.
// lastPollAt blijft `undefined` tot de EERSTE poll binnenkomt — zo blijft
// README's andere, bewust ondersteunde gebruik ("node dist/main.js starten
// en zelf een browser openen wanneer je wil") intact: een server die nooit
// gepolld is, wordt nooit zelf afgesloten.
// 30s (i.p.v. iets dichter bij de 1200ms-cadans) is bewust ruim: Chrome
// vertraagt timers in een verborgen/geminimaliseerd venster al vanzelf (tot
// ~1x/seconde de eerste minuten) — een korte drempel zou een enkel
// geminimaliseerd (maar niet gesloten) venster ten onrechte als "dicht"
// behandelen en een legitieme, onbeheerde lange taak afbreken.
const POLL_STALE_MS = 30_000;
const WATCHDOG_TICK_MS = 5_000;

let lastPollAt: number | undefined;
let idleAbortLogged = false;

function watchdogTick(): void {
  if (lastPollAt === undefined) return;
  const staleFor = Date.now() - lastPollAt;
  if (staleFor < POLL_STALE_MS) {
    idleAbortLogged = false;
    return;
  }

  if (state.isActive) {
    if (!idleAbortLogged) {
      log(
        `Geen poll van de UI meer sinds ${Math.round(staleFor / 1000)}s tijdens een actieve run — ` +
          `venster lijkt gesloten, run wordt afgebroken.`,
      );
      idleAbortLogged = true;
    }
    state.requestAbort();
    return; // laat runGoal() zijn eigen finally (hand.close() + markDone/markError) afhandelen
  }

  log(
    `Geen poll van de UI meer sinds ${Math.round(staleFor / 1000)}s en geen actieve run — ` +
      `venster lijkt gesloten, server stopt.`,
  );
  clearInterval(watchdogTimer);
  server.close();
  // Fallback: als server.close() blijft hangen (bv. een hangende socket),
  // toch afsluiten — .unref() zodat dit zelf nooit het proces open houdt.
  setTimeout(() => process.exit(0), 2000).unref();
}

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
      // Géén req.destroy() hier: dat sluit de onderliggende socket, waardoor
      // de 413-respons hieronder nooit meer verstuurd kan worden. In plaats
      // daarvan: stoppen met opbouwen (geheugen blijft begrensd), de rest van
      // de stream laten leeglopen, en normaal antwoorden.
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
// browser-"simple request" zonder CORS-preflight — door application/json te
// eisen dwingen we een preflight af, en omdat deze server geen
// Access-Control-Allow-Origin teruggeeft blokkeert de browser die request al
// vóórdat hij hier aankomt. Zelfde redenering als packages/dashboard/src/main.ts.
function hasJsonContentType(req: IncomingMessage): boolean {
  const raw = req.headers["content-type"];
  if (typeof raw !== "string") return false;
  return raw.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Vangnet: één onverwachte throw ergens in de routing mag nooit het hele
  // proces meeslepen.
  try {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // --- GET / ---
    if (url === "/" && method === "GET") {
      html(res, 200, PAGE_HTML);
      return;
    }

    // --- GET /run/status ---
    if (url === "/run/status" && method === "GET") {
      // page.ts pollt dit elke 1200ms zolang het app-venster open is — de
      // idle-wachter hieronder gebruikt het uitblijven van deze polls als
      // signaal dat het venster gesloten is (zie watchdogTick()).
      lastPollAt = Date.now();
      json(res, 200, { ok: true, ...state.snapshot() });
      return;
    }

    // --- POST /run ---
    if (url === "/run" && method === "POST") {
      if (state.isActive) {
        json(res, 409, { ok: false, detail: "Er draait al een taak — wacht tot die klaar is." });
        return;
      }

      // Claim de run-slot SYNCHROON, direct na de isActive-check en vóór de
      // eerste await hieronder (readBody). Zonder dit kunnen twee POST
      // /run-requests die vlak na elkaar binnenkomen allebei isActive===false
      // zien vóórdat een van beide state.start() bereikt (readBody() geeft
      // het event loop de kans om het tweede request te routeren terwijl het
      // eerste nog op zijn body wacht) — dan lopen er twee losse
      // PlaywrightHand-runs tegelijk in dezelfde gedeelde RunState. claim()
      // sluit dat gat synchroon; elk vroegtijdig return-pad hieronder ruimt
      // de claim weer op via de finally onderaan zodat een afgewezen request
      // niet blijvend "er loopt al iets" blijft melden.
      state.claim();
      let started = false;
      try {
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

        // Domeinen afleiden: expliciet meegegeven, of afgeleid van url —
        // zelfde patroon als main-server.ts's POST /goal.
        const startUrl = coerceOptionalUrl(parsed["url"]);
        let domains = coerceOptionalDomains(parsed["domains"]) ?? [];
        if (!domains.length && startUrl) {
          try {
            domains = [new URL(startUrl).hostname];
          } catch {
            /* ongeldige URL — hieronder gevangen door de lege-domains-check */
          }
        }
        if (!domains.length) {
          json(res, 400, {
            ok: false,
            detail: "Geef 'domains' op of een 'url' waaruit het domein afgeleid kan worden",
          });
          return;
        }

        const maxSteps = coerceOptionalMaxSteps(parsed["maxSteps"]) ?? 30;

        state.start(goalCheck.goal);
        started = true;
        json(res, 202, { ok: true, started: true });
        void runGoal({ goal: goalCheck.goal, url: startUrl, domains, maxSteps }, state);
      } finally {
        if (!started) state.release();
      }
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
  log(`Luistert op ${HOST}:${PORT}`);
  log(`Open http://${HOST}:${PORT}/ voor de YAD-app (of dubbelklik launch.bat)`);
});

server.on("error", (e) => {
  log(`Server-fout: ${(e as Error).message}`);
  process.exit(1);
});

const watchdogTimer = setInterval(watchdogTick, WATCHDOG_TICK_MS);

// Nette afsluiting bij Ctrl+C of een taskkill/kill-signaal — vooral relevant
// voor het door README gedocumenteerde "node dist/main.js" standalone-pad
// (launch.ts's eigen server draait detached en ontvangt deze signalen sowieso
// niet vanuit een terminal). Vóór deze wijziging had main.ts hier helemaal
// geen handler voor.
function shutdown(signal: string): void {
  log(`${signal} ontvangen — server stopt.`);
  clearInterval(watchdogTimer);
  server.close();
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
