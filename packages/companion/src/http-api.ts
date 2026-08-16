/**
 * Lokale HTTP trigger-API — luistert op 127.0.0.1:3747.
 *
 * Hierdoor kan Claude Code (CLI) direct commando's sturen naar de companion
 * zonder dat de gebruiker iets hoeft te klikken in de extensie.
 *
 * Endpoints:
 *   GET  /status                → { ok, connected }
 *   POST /capture               → { ok, path } (page-capture in Chrome)
 *   POST /goal                  → { ok, ...GoalResult } (body: { goal, url?, sync?, maxSteps? })
 *   POST /navigate              → { ok } (body: { url })
 *   GET  /result                → laatste synchrone run-resultaat
 *   POST /verify                → stap-verificatie (body: { runId, stepStart?, stepEnd?, retries? })
 *   POST /save-session          → sessie opslaan (body: { account: "A"|"B" })
 *   GET  /assist                → stuck-status
 *   POST /assist                → herstelplan sturen (body: { hint, reason?, confidence?, avoid? })
 *   POST /cdp/capture/start     → begin netwerk vastleggen (body: { urlFilter?, tabId? })
 *   POST /cdp/capture/stop      → stop + geef alle verzoeken terug
 *   POST /cdp/evaluate          → voer JS uit in pagina (body: { expression, tabId? })
 *   POST /cdp/response-body     → response-body voor requestId (body: { requestId, tabId? })
 *   POST /cdp/dom-dump          → security-relevante DOM (hidden inputs, CSRF, data-attrs)
 *   POST /cdp/idor-compare      → test URL met sessie A (browser) + sessie B (cookie string), geeft diff
 *   POST /cdp/intercept/start   → onderschep requests (body: { urlFilter?, tabId? })
 *   POST /cdp/intercept/stop    → stop interceptie
 *   POST /cdp/intercept/continue→ laat onderschept request door / blokkeer / overschrijf (body: { requestId, block?, responseBody?, modifiedHeaders? })
 *   GET  /cdp/cookies           → haal alle cookies op van de actieve tab
 *   POST /cdp/cookies/set       → set cookies voor de actieve tab (body: { cookies, url? })
 *   POST /cdp/fill-spa          → vul input-veld in React/Vue/Angular SPA via CDP (body: { selector, value, submit?, waitMs? })
 *
 * Beveiliging (Exposure-check):
 *   - Bindt ALLEEN aan 127.0.0.1 — niet bereikbaar van buiten de machine
 *   - Host-header-check tegen DNS-rebinding: een TCP-verbinding kan lokaal lijken
 *     (remoteAddress 127.0.0.1) terwijl een kwaadwillige webpagina in de browser
 *     van de gebruiker het verzoek op afstand initieerde. Alleen Host: localhost:3747
 *     of 127.0.0.1:3747 wordt geaccepteerd als "echt lokaal" (2026-07-28 gefixt).
 *   - Lokaal verkeer (remoteAddress 127.0.0.1/::1 MET geldige Host-header): ongewijzigd,
 *     geen auth nodig (alleen lokale processen zoals Claude Code kunnen dit bereiken)
 *   - Niet-lokaal verkeer: standaard geweigerd (403), tenzij YAD_EXTERNAL_MODE=1
 *     bewust gezet is. Dan gelden: API-key via YAD_API_KEYS (header X-API-Key),
 *     endpoint-allowlist (alleen /status + /goal — geen cdp/*, fs/*, save-session),
 *     rate-limit (20 req/min per key+IP), audit-log (zie external-gate.ts)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, basename, join, resolve as resolvePath } from "node:path";
import { readSteps } from "./history/step-reader.js";
import { verifySteps } from "./verify/verifier.js";
import { checkExternalGate } from "./external-gate.js";
import type { BrainSession } from "./session.js";
import type { Substate } from "./agent/substate.js";
import type { LlmRouter } from "./engine/router.js";

const PORT = 3747;

/** Detecteert of een tekst eruitziet als een ruwe paginadump (niet gesynthetiseerd). */
function looksLikeRawDump(text: string): boolean {
  if (!text || text.length < 200) return false;
  // Genummerde lijst = al goed gesynthetiseerd
  if (/^\d+\.\s/.test(text.trim())) return false;
  // Veel korte woorden aaneengeplakt, weinig echte newlines = raw dump
  const newlineRatio = (text.match(/\n/g) ?? []).length / text.length;
  const hasStructure = newlineRatio > 0.01 || /\n\d+\./.test(text);
  return !hasStructure && text.length > 400;
}

async function cleanWithGroq(goal: string, rawParts: string[], fallbackSummary?: string): Promise<string> {
  const apiKey = process.env["GROQ_API_KEY"] ?? "";
  const allParts = [...rawParts];
  if (fallbackSummary && looksLikeRawDump(fallbackSummary)) {
    allParts.push(fallbackSummary);
  }
  if (!apiKey || allParts.length === 0) return fallbackSummary ?? rawParts.join("\n");
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: "Je bent een data-extractor. Geef ALLEEN de gevraagde informatie terug als een nette, overzichtelijke genummerde lijst. Geen navigatie-items, geen menuknoppen, geen cookie-teksten, geen technische rommel. Formaat: '1. Titel — Bedrijf — Locatie' voor vacatures/producten, '1. Naam' voor personen, of een directe zin voor vragen. Maximaal 20 items.",
          },
          {
            role: "user",
            content: `Doel: "${goal}"\n\nData:\n${allParts.join("\n\n").slice(0, 5000)}\n\nGeef een nette, gestructureerde lijst met alleen de relevante informatie voor dit doel.`,
          },
        ],
        max_tokens: 1000,
        temperature: 0.1,
      }),
    });
    if (!resp.ok) return fallbackSummary ?? rawParts.join("\n");
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? (fallbackSummary ?? rawParts.join("\n"));
  } catch {
    return fallbackSummary ?? rawParts.join("\n");
  }
}

const FS_MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".rtf": "application/rtf",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
  ".json": "application/json",
  ".xml": "application/xml",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".odt": "application/vnd.oasis.opendocument.text",
};

/** Mappen die standaard worden doorzocht bij /fs/list-files en /fs/search-files. */
function defaultSearchDirs(): string[] {
  const user = process.env["USERNAME"] ?? process.env["USER"] ?? "hp";
  return [
    `C:\\Users\\${user}\\Desktop`,
    `C:\\Users\\${user}\\Documents`,
    `C:\\Users\\${user}\\Downloads`,
  ];
}

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

/**
 * Blokkeert DNS-rebinding: een kwaadwillige pagina in de browser van de gebruiker
 * kan een domeinnaam laten "rebinden" naar 127.0.0.1, waardoor req.socket.remoteAddress
 * gewoon lokaal lijkt terwijl het verzoek in werkelijkheid door vreemde JS op afstand
 * is gestart. De browser stuurt in dat geval nog steeds de Host-header van de
 * oorspronkelijke (niet-lokale) hostnaam mee — dat is wat we hier controleren.
 */
function hasValidHostHeader(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  return host === `localhost:${PORT}` || host === `127.0.0.1:${PORT}`;
}

export function startHttpApi(session: BrainSession, log: (m: string) => void, externalRouter?: LlmRouter): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const addr = req.socket.remoteAddress;
    const isLocalhost = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
    if (isLocalhost && !hasValidHostHeader(req)) {
      // DNS-rebinding-poging: TCP-verbinding lijkt lokaal, maar Host-header verraadt
      // een externe oorsprong. Behandel als niet-lokaal (dezelfde 403-gate hieronder).
      json(res, 403, { ok: false, detail: "Ongeldige Host-header — verzoek geweigerd" });
      return;
    }
    if (!isLocalhost) {
      // Niet-lokaal verkeer: standaard exact hetzelfde 403-gedrag als voorheen,
      // tenzij YAD_EXTERNAL_MODE bewust aan staat (zie external-gate.ts).
      const gate = checkExternalGate(req, req.url ?? "/", req.method ?? "GET");
      if (!gate.allow) {
        json(res, gate.status, gate.body);
        return;
      }
    }

    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // ── /status : leeft de verbinding, en kán hij ook echt iets? ─────────────
    //
    // Dit meldde eerder `connected: true` terwijl de pagina muurvast zat achter een
    // onafgehandeld dialoogvenster. Elke opdracht liep vast en de meter stond op groen.
    // Voor iets dat verhuurd wordt is dat het gevaarlijkste soort defect, want de klant
    // ziet gezond terwijl er niets gebeurt.
    //
    // `connected` zegt alleen dat de native-messaging-pijp openstaat. Dat is niet
    // hetzelfde als kunnen werken. Daarom nu ook `responsive`: we vragen de pagina echt
    // iets, met een korte tijdslimiet. Antwoordt hij niet, dan staat er `responsive:
    // false` met de reden erbij.
    //
    // De diepe controle kost een halve seconde en staat daarom niet standaard aan: veel
    // aanroepers pollen /status in een lus. Met `?deep=1` vraag je erom, en dat is wat de
    // gezondheidslus doet.
    if (url.startsWith("/status") && method === "GET") {
      const connected = session.isConnected();
      const wilDiep = new URL(url, "http://x").searchParams.get("deep") === "1";
      if (!wilDiep || !connected) {
        json(res, 200, { ok: true, connected, version: "0.1.0" });
        return;
      }
      const start = Date.now();
      try {
        // Bewust de goedkoopste vraag die er is. Komt er antwoord, dan is de tab niet
        // geblokkeerd; wát het antwoord is doet er niet toe.
        const snap = await Promise.race([
          session.requestSnapshot(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("geen antwoord binnen 6s")), 6_000)),
        ]);
        // Niet binair melden. Bij het testen bleek een geblokkeerde pagina er 5725 ms
        // over te doen waar hij normaal 104 ms nodig heeft: vijftig keer trager, maar
        // technisch nog binnen de tijd, dus "responsive: true". Voor een agent is zo'n
        // pagina praktisch stuk. Dood-of-levend is hier te grof; de reactietijd zelf is
        // het signaal.
        const reactieMs = Date.now() - start;
        const traag = reactieMs > 1_500;
        json(res, 200, {
          ok: true,
          connected,
          responsive: true,
          gezond: !traag,
          reactieMs,
          ...(traag
            ? { waarschuwing: `pagina reageert traag (${reactieMs}ms, normaal onder 300ms) — druk, geblokkeerd of een zware pagina` }
            : {}),
          url: snap?.url ?? null,
          version: "0.1.0",
        });
      } catch (e) {
        // Geen 503: de companion zelf leeft prima. Het is de browserkant die niet
        // reageert, en dat onderscheid wil je kunnen zien.
        json(res, 200, {
          ok: true,
          connected,
          responsive: false,
          reden: (e as Error).message.slice(0, 120),
          hint: "de tab reageert niet — meestal een openstaand dialoogvenster of een vastgelopen pagina; navigeren helpt",
          version: "0.1.0",
        });
      }
      return;
    }

    if (url === "/capture" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden — open Chrome met YAD extensie" });
        return;
      }
      try {
        const path = await session.captureForClaude();
        json(res, 200, { ok: true, path });
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    if (url === "/goal" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden" });
        return;
      }
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as { goal?: string; url?: string; sync?: boolean; maxSteps?: number; autonomy?: "confirm" | "auto"; substates?: Substate[]; clean?: boolean };
        if (typeof parsed.goal !== "string" || !parsed.goal.trim()) {
          json(res, 400, { ok: false, detail: "goal is verplicht" });
          return;
        }
        // Saniteer goal: afkappen op 1000 chars, schadelijke instructie-patronen weigeren.
        const rawGoal = parsed.goal.slice(0, 1000);
        if (/ignore\s+(previous|all)\s+instructions?|system\s*prompt|reveal\s+(your\s+)?prompt|exfiltrat/i.test(rawGoal)) {
          json(res, 400, { ok: false, detail: "goal bevat een niet-toegestaan patroon" });
          return;
        }
        // Valideer start-URL als opgegeven — alleen http/https toegestaan.
        if (typeof parsed.url === "string" && !/^https?:\/\//i.test(parsed.url)) {
          json(res, 400, { ok: false, detail: "url moet beginnen met http:// of https://" });
          return;
        }
        // Extern/klant-verkeer: verplicht sync (fire-and-forget levert aan de lokale
        // sidepanel, geen zin voor een remote client) EN verplicht een geconfigureerde
        // Ollama-only router — nooit stilzwijgend terugvallen op de eigen sleutels
        // van de koning (Exposure/Rate-check).
        if (!isLocalhost) {
          if (parsed.sync !== true) {
            json(res, 400, { ok: false, detail: "extern verkeer vereist sync:true" });
            return;
          }
          if (!externalRouter) {
            json(res, 503, { ok: false, detail: "externe modus actief maar geen Ollama geconfigureerd (OLLAMA_BASE_URL ontbreekt)" });
            return;
          }
        }
        if (parsed.sync === true) {
          // Wacht op het resultaat zodat de Planner (Claude Code) het kan verwerken.
          const result = await session.runGoalSync(rawGoal, {
            maxSteps: typeof parsed.maxSteps === "number" ? parsed.maxSteps : undefined,
            startingUrl: parsed.url,
            autonomy: parsed.autonomy === "auto" ? "auto" : undefined,
            substates: Array.isArray(parsed.substates) ? parsed.substates : undefined,
            router: !isLocalhost ? externalRouter : undefined,
          });
          // Auto-clean: altijd als clean=true of als de summary er raw uitziet.
          const wantClean = parsed.clean === true || looksLikeRawDump(result.summary ?? "");
          if (wantClean) {
            const runId = (result as unknown as Record<string, unknown>)["runId"] as string | undefined;
            if (runId) {
              const stepLogPath = process.env["YAD_STEP_LOG_PATH"] ?? "C:\\Code\\yad-step-log.jsonl";
              const steps = readSteps(stepLogPath, runId, 1, 9999);
              const extractedParts = steps
                .filter((s) => typeof s.extracted === "string" && s.extracted.trim().length > 0)
                .map((s) => s.extracted as string);
              const cleaned = await cleanWithGroq(rawGoal, extractedParts, result.summary);
              json(res, 200, { ok: true, ...result, cleaned });
            } else {
              json(res, 200, { ok: true, ...result, cleaned: null });
            }
          } else {
            json(res, 200, { ok: true, ...result });
          }
        } else {
          // Fire-and-forget: resultaat gaat naar de extension sidepanel (bestaand gedrag).
          session.triggerGoal(rawGoal, parsed.url);
          json(res, 200, { ok: true, goal: rawGoal });
        }
      } catch (e) {
        json(res, 400, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    if (url === "/result" && method === "GET") {
      const resultPath = process.env["YAD_RESULT_PATH"] ?? "C:\\Code\\yad-goal-result.json";
      try {
        const content = readFileSync(resultPath, "utf-8");
        json(res, 200, JSON.parse(content));
      } catch {
        json(res, 404, { ok: false, detail: "Geen resultaat beschikbaar — nog geen synchrone run gedraaid" });
      }
      return;
    }

    if (url === "/navigate" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden" });
        return;
      }
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as { url?: string };
        if (typeof parsed.url !== "string" || !/^https?:\/\//i.test(parsed.url)) {
          json(res, 400, { ok: false, detail: "url is verplicht en moet http(s) zijn" });
          return;
        }
        const ok = await session.navigateTo(parsed.url);
        json(res, 200, { ok });
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    if (url === "/adopt-tab" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden" });
        return;
      }
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as { pattern?: string };
        if (typeof parsed.pattern !== "string" || !parsed.pattern.trim()) {
          json(res, 400, { ok: false, detail: "pattern is verplicht" });
          return;
        }
        const result = await session.adoptTab(parsed.pattern.trim());
        json(res, 200, result);
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    if (url === "/verify" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden" });
        return;
      }
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as {
          runId?: string;
          stepStart?: number;
          stepEnd?: number;
          retries?: number;
        };
        if (typeof parsed.runId !== "string" || !parsed.runId) {
          json(res, 400, { ok: false, detail: "runId is verplicht" });
          return;
        }
        const stepLogPath = process.env["YAD_STEP_LOG_PATH"] ?? "C:\\Code\\yad-step-log.jsonl";
        const stepStart = typeof parsed.stepStart === "number" ? parsed.stepStart : 1;
        const stepEnd = typeof parsed.stepEnd === "number" ? parsed.stepEnd : 9999;
        const retries = Math.min(typeof parsed.retries === "number" ? parsed.retries : 2, 5);

        const steps = readSteps(stepLogPath, parsed.runId, stepStart, stepEnd);
        if (steps.length === 0) {
          json(res, 404, {
            ok: false,
            detail: `Geen stappen in log voor runId=${parsed.runId} stap ${stepStart}-${stepEnd}`,
          });
          return;
        }

        const result = await verifySteps(parsed.runId, steps, retries, session);
        json(res, 200, { ok: true, ...result });
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    if (url === "/assist" && method === "GET") {
      const stuckPath = process.env["YAD_STUCK_PATH"] ?? "C:\\Code\\yad-stuck.json";
      try {
        const content = JSON.parse(readFileSync(stuckPath, "utf-8")) as Record<string, unknown>;
        if (content["resolved"] === true) {
          json(res, 200, { stuck: false });
        } else {
          json(res, 200, { stuck: true, ...content });
        }
      } catch {
        json(res, 200, { stuck: false });
      }
      return;
    }

    if (url === "/assist" && method === "POST") {
      try {
        const body = await readBody(req);
        // Accepteert gestructureerde RecoveryPlan of backwards-compat { plan: string }
        const parsed = JSON.parse(body) as {
          hint?: string;      // voorkeur: instructie voor YAD
          plan?: string;      // backwards-compat alias voor hint
          reason?: string;    // diagnostiek: welk type vastloper (bv. "selector_drift")
          confidence?: number; // 0–1: hoe zeker is de herstelstrategie
          avoid?: string[];   // acties die YAD NIET opnieuw moet proberen
        };
        const hint = (parsed.hint ?? parsed.plan ?? "").trim();
        if (!hint) {
          json(res, 400, { ok: false, detail: "hint (of plan) is verplicht" });
          return;
        }
        log(
          `[assist] herstelplan: reden="${parsed.reason ?? "onbekend"}" zekerheid=${parsed.confidence ?? "?"} vermijden=${parsed.avoid?.length ?? 0} actie(s)`,
        );
        const accepted = session.setRecoveryPlan(hint, {
          reason: parsed.reason,
          confidence: parsed.confidence,
          avoid: parsed.avoid,
        });
        if (accepted) {
          json(res, 200, { ok: true });
        } else {
          json(res, 409, { ok: false, detail: "Geen actieve stuck-run om een herstelplan naar te sturen" });
        }
      } catch (e) {
        json(res, 400, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    if (url === "/save-session" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden — open Chrome met YAD extensie" });
        return;
      }
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as { account?: string };
        const label: "A" | "B" = parsed.account === "B" ? "B" : "A";
        const result = await session.captureAndSaveSession(label);
        json(res, result.ok ? 200 : 422, result);
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    // ── CDP: netwerkverkeer vastleggen + JS uitvoeren in pagina-context ──────────

    if (url === "/cdp/capture/start" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden" });
        return;
      }
      try {
        let urlFilter: string | undefined;
        let tabId: number | undefined;
        const raw = await readBody(req);
        if (raw.trim()) {
          const parsed = JSON.parse(raw) as { urlFilter?: string; tabId?: number };
          if (typeof parsed.urlFilter === "string") urlFilter = parsed.urlFilter;
          if (typeof parsed.tabId === "number") tabId = parsed.tabId;
        }
        const result = await session.cdp({ command: "start_capture", urlFilter, tabId }, 10_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    if (url === "/cdp/capture/stop" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden" });
        return;
      }
      try {
        // Ruimere timeout: stop_capture wacht tot alle response-bodies zijn opgehaald.
        const result = await session.cdp({ command: "stop_capture" }, 30_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    if (url === "/cdp/evaluate" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden" });
        return;
      }
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as { expression?: string; tabId?: number };
        if (typeof parsed.expression !== "string" || !parsed.expression.trim()) {
          json(res, 400, { ok: false, detail: "expression is verplicht" });
          return;
        }
        const result = await session.cdp({
          command: "evaluate",
          expression: parsed.expression.slice(0, 20_000),
          tabId: typeof parsed.tabId === "number" ? parsed.tabId : undefined,
        }, 60_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    if (url === "/cdp/response-body" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden" });
        return;
      }
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as { requestId?: string; tabId?: number };
        if (typeof parsed.requestId !== "string" || !parsed.requestId.trim()) {
          json(res, 400, { ok: false, detail: "requestId is verplicht" });
          return;
        }
        const result = await session.cdp({
          command: "get_response_body",
          requestId: parsed.requestId,
          tabId: typeof parsed.tabId === "number" ? parsed.tabId : undefined,
        }, 15_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    if (url === "/cdp/replay" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden" });
        return;
      }
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as {
          url?: string;
          method?: string;
          headers?: Record<string, string>;
          body?: string;
        };
        if (typeof parsed.url !== "string" || !/^https?:\/\//i.test(parsed.url)) {
          json(res, 400, { ok: false, detail: "url is verplicht en moet http(s) zijn" });
          return;
        }
        const fetchExpr = `(async () => {
  const r = await fetch(${JSON.stringify(parsed.url)}, {
    method: ${JSON.stringify(parsed.method ?? "GET")},
    headers: ${JSON.stringify(parsed.headers ?? {})},
    ${parsed.body ? `body: ${JSON.stringify(parsed.body)},` : ""}
    credentials: "include",
  });
  const body = await r.text();
  return JSON.stringify({
    status: r.status,
    statusText: r.statusText,
    headers: Object.fromEntries(r.headers.entries()),
    body: body.slice(0, 50000),
  });
})()`;
        const result = await session.cdp({ command: "evaluate", expression: fetchExpr }, 30_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    // ── /cdp/dom-dump: security-relevante DOM-elementen ──────────────────────
    // Geeft: hidden inputs, meta tags, data-* attributen, CSRF-tokens, HTML-commentaar.
    // Essentieel voor bug bounty: vindt CSRF-tokens, verborgen velden, lekt data.

    if (url === "/cdp/dom-dump" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden" });
        return;
      }
      try {
        const raw = await readBody(req);
        const parsed = raw.trim() ? (JSON.parse(raw) as { tabId?: number }) : {};
        const dumpExpr = `(function domDump() {
  const result = {
    url: location.href,
    hiddenInputs: [],
    metaTags: [],
    csrfTokens: [],
    dataAttributes: [],
    formActions: [],
    inlineScriptUrls: [],
  };
  // Hidden inputs — CSRF tokens, session IDs, user IDs
  document.querySelectorAll('input[type=hidden]').forEach(el => {
    const name = el.getAttribute('name') || '';
    const value = el.value || '';
    result.hiddenInputs.push({ name, value: value.slice(0, 500) });
    const lname = name.toLowerCase();
    if (lname.includes('csrf') || lname.includes('token') || lname.includes('nonce') || lname.includes('xsrf')) {
      result.csrfTokens.push({ name, value: value.slice(0, 500), source: 'hidden_input' });
    }
  });
  // Meta tags — CSRF in meta[name=csrf-token], ook viewport/robots leaks
  document.querySelectorAll('meta').forEach(el => {
    const name = el.getAttribute('name') || el.getAttribute('property') || '';
    const content = el.getAttribute('content') || '';
    result.metaTags.push({ name, content: content.slice(0, 500) });
    const lname = name.toLowerCase();
    if (lname.includes('csrf') || lname.includes('token') || lname.includes('nonce')) {
      result.csrfTokens.push({ name, value: content.slice(0, 500), source: 'meta' });
    }
  });
  // Form actions — ontdek alle endpoints
  document.querySelectorAll('form').forEach(el => {
    result.formActions.push({
      action: el.getAttribute('action') || '',
      method: el.getAttribute('method') || 'GET',
      id: el.getAttribute('id') || '',
    });
  });
  // data-* attributen op elementen (eerste 200 elementen)
  const withData = document.querySelectorAll('[data-user],[data-id],[data-token],[data-key],[data-session],[data-account],[data-uid],[data-userid]');
  withData.forEach(el => {
    const attrs = {};
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-')) attrs[attr.name] = attr.value.slice(0, 200);
    }
    if (Object.keys(attrs).length) {
      result.dataAttributes.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', attrs });
    }
  });
  // Inline script URL-patronen (API endpoints, tokens in JS)
  document.querySelectorAll('script:not([src])').forEach(el => {
    const text = el.textContent || '';
    const urls = text.match(/["']\/api\/[^"']{1,200}["']/g) || [];
    const tokens = text.match(/["'](token|csrf|key|secret|password)[^"']{0,5}["']\s*[:=]\s*["'][^"']{8,200}["']/gi) || [];
    if (urls.length || tokens.length) {
      result.inlineScriptUrls.push({ urls: urls.slice(0, 20), tokens: tokens.slice(0, 10) });
    }
  });
  return JSON.stringify(result);
})()`;
        const result = await session.cdp({
          command: "evaluate",
          expression: dumpExpr,
          tabId: typeof parsed.tabId === "number" ? parsed.tabId : undefined,
        }, 15_000);
        if (!result.ok) { json(res, 500, result); return; }
        try {
          const parsed2 = JSON.parse(result.value ?? "{}");
          json(res, 200, { ok: true, ...parsed2 });
        } catch {
          json(res, 200, { ok: true, raw: result.value });
        }
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    // ── /cdp/idor-compare: test dezelfde URL met twee sessies en vergelijk ──
    // Session A = huidige browser-sessie (credentials: include via CDP evaluate).
    // Session B = expliciete cookie-string vanuit opgeslagen sessie (Node.js fetch).
    // Vergelijkt status + body, geeft een initieel IDOR-oordeel terug.

    if (url === "/cdp/idor-compare" && method === "POST") {
      if (!session.isConnected()) {
        json(res, 503, { ok: false, detail: "Chrome niet verbonden" });
        return;
      }
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as {
          url?: string;
          method?: string;
          body?: string;
          headers?: Record<string, string>;
          cookiesB?: string;  // Cookie-header waarde voor sessie B
        };
        if (typeof parsed.url !== "string" || !/^https?:\/\//i.test(parsed.url)) {
          json(res, 400, { ok: false, detail: "url is verplicht en moet http(s) zijn" });
          return;
        }
        if (typeof parsed.cookiesB !== "string" || !parsed.cookiesB.trim()) {
          json(res, 400, { ok: false, detail: "cookiesB is verplicht (Cookie-header string voor sessie B)" });
          return;
        }

        // Sessie A: via huidige browser-sessie (CDP evaluate, credentials: include)
        const fetchAExpr = `(async () => {
  const r = await fetch(${JSON.stringify(parsed.url)}, {
    method: ${JSON.stringify(parsed.method ?? "GET")},
    headers: ${JSON.stringify(parsed.headers ?? {})},
    ${parsed.body ? `body: ${JSON.stringify(parsed.body)},` : ""}
    credentials: "include",
  });
  const body = await r.text();
  return JSON.stringify({ status: r.status, statusText: r.statusText,
    headers: Object.fromEntries(r.headers.entries()), body: body.slice(0, 50000) });
})()`;
        const resultA = await session.cdp({ command: "evaluate", expression: fetchAExpr }, 30_000);

        type RespData = { status: number; statusText: string; headers: Record<string, string>; body: string };

        // Sessie B: via Node.js fetch met expliciete Cookie-header (omzeilt browser-cookie sandbox)
        let sessionBData: RespData | null = null;
        let sessionBError: string | undefined;
        try {
          const headersB: Record<string, string> = {
            "Cookie": parsed.cookiesB,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json, text/html, */*",
            ...(parsed.headers ?? {}),
          };
          const responseB = await fetch(parsed.url, {
            method: parsed.method ?? "GET",
            headers: headersB as Record<string, string>,
            body: parsed.body,
          });
          const bodyB = await responseB.text();
          const hdrs: Record<string, string> = {};
          responseB.headers.forEach((v: string, k: string) => { hdrs[k] = v; });
          sessionBData = { status: responseB.status, statusText: responseB.statusText, headers: hdrs, body: bodyB.slice(0, 50_000) };
        } catch (e) {
          sessionBError = (e as Error).message;
        }

        // Parse sessie A resultaat
        let sessionAData: RespData | null = null;
        if (resultA.ok && resultA.value) {
          try { sessionAData = JSON.parse(resultA.value) as RespData; } catch { /* raw */ }
        }

        // Simpele diff + IDOR-oordeel
        const statusMatch = (sessionAData?.status ?? -1) === (sessionBData?.status ?? -2);
        const bodyA = sessionAData?.body ?? "";
        const bodyB2 = sessionBData?.body ?? "";
        const bodyLengthDiff = Math.abs(bodyA.length - bodyB2.length);
        const longerLength = Math.max(bodyA.length, bodyB2.length) || 1;
        const bodySimilarity = Math.round((1 - bodyLengthDiff / longerLength) * 100);

        // IDOR-verdict: als B dezelfde 2xx krijgt als A → potential IDOR
        const aStatus = sessionAData?.status ?? 0;
        const bStatus = sessionBData?.status ?? 0;
        const aIs2xx = aStatus >= 200 && aStatus < 300;
        const bIs2xx = bStatus >= 200 && bStatus < 300;
        const verdict = aIs2xx && bIs2xx && bodySimilarity > 70
          ? "potential_idor"
          : aIs2xx && bIs2xx && bodySimilarity <= 70
          ? "different_content"
          : !bIs2xx
          ? "protected"
          : "inconclusive";

        json(res, 200, {
          ok: true,
          sessionA: sessionAData ?? { error: resultA.detail ?? "geen data" },
          sessionB: sessionBData ?? { error: sessionBError ?? "geen data" },
          diff: { statusMatch, bodySimilarity, verdict },
        });
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    // ── /cdp/intercept/* : request-interceptie via CDP Fetch domain ──────────

    if (url === "/cdp/intercept/start" && method === "POST") {
      if (!session.isConnected()) { json(res, 503, { ok: false, detail: "Chrome niet verbonden" }); return; }
      try {
        const raw = await readBody(req);
        const parsed = raw.trim() ? (JSON.parse(raw) as { urlFilter?: string; tabId?: number }) : {};
        const result = await session.cdp({ command: "intercept_enable", urlFilter: parsed.urlFilter, tabId: parsed.tabId }, 10_000);
        json(res, result.ok ? 200 : 500, { ok: result.ok, detail: result.detail ?? "interceptie actief" });
      } catch (e) { json(res, 500, { ok: false, detail: (e as Error).message }); }
      return;
    }

    if (url === "/cdp/intercept/stop" && method === "POST") {
      if (!session.isConnected()) { json(res, 503, { ok: false, detail: "Chrome niet verbonden" }); return; }
      try {
        const result = await session.cdp({ command: "intercept_disable" }, 10_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) { json(res, 500, { ok: false, detail: (e as Error).message }); }
      return;
    }

    if (url === "/cdp/intercept/continue" && method === "POST") {
      if (!session.isConnected()) { json(res, 503, { ok: false, detail: "Chrome niet verbonden" }); return; }
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as {
          requestId?: string;
          block?: boolean;
          responseBody?: string;
          modifiedHeaders?: Array<{ name: string; value: string }>;
        };
        if (!parsed.requestId) { json(res, 400, { ok: false, detail: "requestId is verplicht" }); return; }
        const result = await session.cdp({
          command: "intercept_continue",
          requestId: parsed.requestId,
          block: parsed.block,
          responseBody: parsed.responseBody,
          modifiedHeaders: parsed.modifiedHeaders,
        }, 15_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) { json(res, 500, { ok: false, detail: (e as Error).message }); }
      return;
    }

    // ── /cdp/cookies : cookies lezen en schrijven via CDP ────────────────────

    if (url === "/cdp/cookies" && method === "GET") {
      if (!session.isConnected()) { json(res, 503, { ok: false, detail: "Chrome niet verbonden" }); return; }
      try {
        const result = await session.cdp({ command: "get_cookies" }, 10_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) { json(res, 500, { ok: false, detail: (e as Error).message }); }
      return;
    }

    // ── /snapshot : wat ZIET de agent precies ────────────────────────────────
    // /capture geeft een vereenvoudigde tekstweergave (url, titel, tekst, links) die
    // bedoeld is voor een mens of voor Claude. De agent werkt met iets heel anders:
    // een lijst interactieve elementen met refs. Dat verschil kostte me een verkeerde
    // conclusie — ik zag shadow-DOM-inhoud niet in /capture en dacht dat de agent hem
    // ook niet zag, terwijl perception open shadow roots juist wél doorloopt.
    //
    // Daarom dit endpoint: exact de snapshot waarop de agent zijn besluiten baseert,
    // inclusief de refs. Onmisbaar om te controleren of iets werkelijk waarneembaar is
    // en niet alleen in theorie bereikbaar.
    if (url === "/snapshot" && (method === "GET" || method === "POST")) {
      if (!session.isConnected()) { json(res, 503, { ok: false, detail: "Chrome niet verbonden" }); return; }
      try {
        const snap = await session.requestSnapshot();
        json(res, 200, { ok: true, snapshot: snap });
      } catch (e) { json(res, 500, { ok: false, detail: (e as Error).message }); }
      return;
    }

    // ── /act : voer één losse actie uit, zonder LLM ──────────────────────────
    // Alles ging tot nu toe via /goal, en dat vraagt een taalmodel om te plannen. Voor
    // het toetsen van een enkele mogelijkheid ("kan hij typen in een cross-origin
    // iframe") is dat onhandig, traag en quotum-afhankelijk, en je meet dan het model
    // in plaats van de hand. Hiermee kun je precies één actie afvuren en het resultaat
    // zien. Dit draagt ook de capaciteitsproef die als regressietest draait.
    if (url === "/act" && method === "POST") {
      if (!session.isConnected()) { json(res, 503, { ok: false, detail: "Chrome niet verbonden" }); return; }
      try {
        const parsed = JSON.parse(await readBody(req)) as { action?: unknown };
        if (!parsed.action || typeof parsed.action !== "object") {
          json(res, 400, { ok: false, detail: "action (object) is verplicht" });
          return;
        }
        const result = await session.act(parsed.action as Parameters<typeof session.act>[0]);
        json(res, 200, { ok: true, result });
      } catch (e) { json(res, 500, { ok: false, detail: (e as Error).message }); }
      return;
    }

    // ── /downloads : welke bestanden zijn er binnengekomen ───────────────────
    // Zonder dit kon YAD wél op een downloadlink klikken maar daarna niet weten of er
    // iets binnenkwam, hoe het heette of waar het stond. "Haal het rapport op en mail
    // het" was daarmee onmogelijk, terwijl dat een standaardklus is.
    //
    // Gebruik: noteer de tijd, klik de link, vraag dan `?sinds=<ms>` op. Zonder dat
    // filter krijg je ook oude downloads terug en denk je onterecht dat je klik werkte.
    // Het bestand zelf komt hier NIET doorheen: de companion draait op dezelfde machine
    // en leest het gewoon van schijf met /fs/read-file. Scheelt een pijp vol bytes.
    if (url.startsWith("/downloads") && method === "GET") {
      if (!session.isConnected()) { json(res, 503, { ok: false, detail: "Chrome niet verbonden" }); return; }
      try {
        const q = new URL(url, "http://x").searchParams.get("sinds");
        const sinds = q && Number.isFinite(Number(q)) ? Number(q) : undefined;
        const result = await session.cdp({ command: "list_downloads", sinds }, 10_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) { json(res, 500, { ok: false, detail: (e as Error).message }); }
      return;
    }

    // ── /close-tabs : sluit alle tabbladen behalve die matchen op keepUrlContains ──
    // Body: { "keepUrlContains": "web4.ping64.net/roundcube" }
    if (url === "/close-tabs" && method === "POST") {
      if (!session.isConnected()) { json(res, 503, { ok: false, detail: "Chrome niet verbonden" }); return; }
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as { keepUrlContains?: string };
        if (typeof parsed.keepUrlContains !== "string" || !parsed.keepUrlContains.trim()) {
          json(res, 400, { ok: false, detail: "keepUrlContains is verplicht" });
          return;
        }
        const result = await session.cdp({ command: "close_other_tabs", keepUrlContains: parsed.keepUrlContains }, 10_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) { json(res, 500, { ok: false, detail: (e as Error).message }); }
      return;
    }

    // ── /reload-extension : herlaad de YAD-extensie zelf na een codewijziging ──
    // Geen body nodig. Gebruik dit na een nieuwe `wxt build` i.p.v. handmatig chrome://extensions
    // te openen (dat is sowieso geblokkeerd voor geautomatiseerde navigatie).
    if (url === "/reload-extension" && method === "POST") {
      if (!session.isConnected()) { json(res, 503, { ok: false, detail: "Chrome niet verbonden" }); return; }
      try {
        const result = await session.cdp({ command: "reload_extension" }, 10_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) { json(res, 500, { ok: false, detail: (e as Error).message }); }
      return;
    }

    // ── /cdp/network/requests : lees gevangen requests zonder capture te stoppen ──
    // Gebruik na /cdp/capture/start + browser-interactie om tokens/params te extraheren.
    // Query: ?filter=game/json (optioneel URL-substring)
    // Voorbeeld: GET /cdp/network/requests?filter=game%2Fjson
    if (url.startsWith("/cdp/network/requests") && method === "GET") {
      if (!session.isConnected()) { json(res, 503, { ok: false, detail: "Chrome niet verbonden" }); return; }
      try {
        const qs = new URL("http://localhost" + url).searchParams;
        const filter = qs.get("filter") ?? undefined;
        const result = await session.cdp({ command: "peek_network_requests", urlFilter: filter }, 10_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) { json(res, 500, { ok: false, detail: (e as Error).message }); }
      return;
    }

    if (url === "/cdp/cookies/set" && method === "POST") {
      if (!session.isConnected()) { json(res, 503, { ok: false, detail: "Chrome niet verbonden" }); return; }
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as {
          cookies?: Array<{ name: string; value: string; domain?: string; path?: string }>;
          url?: string;
          tabId?: number;
        };
        if (!parsed.cookies?.length) { json(res, 400, { ok: false, detail: "cookies array is verplicht" }); return; }
        const result = await session.cdp({
          command: "set_cookies",
          cookies: parsed.cookies,
          cookieUrl: parsed.url,
          tabId: parsed.tabId,
        }, 10_000);
        json(res, result.ok ? 200 : 500, result);
      } catch (e) { json(res, 500, { ok: false, detail: (e as Error).message }); }
      return;
    }

    // ── /cdp/fill-spa : vul een input in React/Vue/Angular SPA via CDP ──────────
    // Body: { selector, value, submit?, waitMs?, tabId? }
    // selector = CSS-selector van het invoerveld (bv. "#searchInput" of "input[placeholder='Zoeken']")
    // value    = de tekst die ingevuld moet worden
    // submit   = true → stuur ook Enter-events (keydown + keypress + keyup) na het invullen
    // waitMs   = ms te wachten na invoke vóór terugkeren (default 400, voor SPA-debounce)

    if (url === "/cdp/fill-spa" && method === "POST") {
      if (!session.isConnected()) { json(res, 503, { ok: false, detail: "Chrome niet verbonden" }); return; }
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as {
          selector: string;
          value: string;
          submit?: boolean;
          waitMs?: number;
          tabId?: number;
        };
        if (!parsed.selector) { json(res, 400, { ok: false, detail: "'selector' is verplicht" }); return; }
        if (typeof parsed.value !== "string") { json(res, 400, { ok: false, detail: "'value' is verplicht" }); return; }
        const waitMs = parsed.waitMs ?? 400;
        const doSubmit = parsed.submit === true;
        // Bouw een JS-expressie die:
        // 1. Het element opzoekt via de CSS-selector
        // 2. De waarde instelt via de native prototype-setter (React-compatibel)
        // 3. 'input' en 'change' events stuurt
        // 4. Optioneel Enter-events stuurt (keydown + keypress + keyup)
        const jsExpr = `(function() {
  const el = document.querySelector(${JSON.stringify(parsed.selector)});
  if (!el) return { ok: false, detail: 'element niet gevonden: ' + ${JSON.stringify(parsed.selector)} };
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  try {
    if (desc && desc.set) desc.set.call(el, ${JSON.stringify(parsed.value)});
    else el.value = ${JSON.stringify(parsed.value)};
  } catch(e) {
    try { el.value = ${JSON.stringify(parsed.value)}; } catch {}
  }
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  ${doSubmit ? `
  const opts = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown',  opts));
  el.dispatchEvent(new KeyboardEvent('keypress', opts));
  el.dispatchEvent(new KeyboardEvent('keyup',    opts));
  ` : ""}
  return { ok: true, filledValue: el.value };
})()`;
        const evalResult = await session.cdp({
          command: "evaluate",
          expression: jsExpr,
          tabId: parsed.tabId,
        }, 10_000);
        // Wacht op SPA-debounce zodat zoekresultaten laden
        await new Promise(r => setTimeout(r, waitMs));
        json(res, evalResult.ok ? 200 : 500, evalResult);
      } catch (e) { json(res, 500, { ok: false, detail: (e as Error).message }); }
      return;
    }

    // ── /fs/* : lokaal bestandssysteem — lijst, zoek, lees ───────────────────

    if (url === "/fs/list-files" && method === "POST") {
      try {
        const raw = await readBody(req);
        const parsed = raw.trim() ? (JSON.parse(raw) as { dir?: string }) : {};
        const dirs = typeof parsed.dir === "string" ? [parsed.dir] : defaultSearchDirs();
        const files: Array<{ name: string; path: string; size: number; ext: string; mimeType: string }> = [];
        for (const dir of dirs) {
          try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isFile()) continue;
              const filePath = join(dir, entry.name);
              const ext = extname(entry.name).toLowerCase();
              try {
                const stat = statSync(filePath);
                files.push({ name: entry.name, path: filePath, size: stat.size, ext, mimeType: FS_MIME_TYPES[ext] ?? "application/octet-stream" });
              } catch { /* niet stat-baar, overslaan */ }
            }
          } catch { /* map bestaat niet */ }
        }
        files.sort((a, b) => a.name.localeCompare(b.name));
        json(res, 200, { ok: true, dirs, files });
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    if (url === "/fs/search-files" && method === "POST") {
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as { q?: string; ext?: string; dir?: string };
        const query = (parsed.q ?? "").toLowerCase();
        const extFilter = parsed.ext ? (parsed.ext.startsWith(".") ? parsed.ext.toLowerCase() : "." + parsed.ext.toLowerCase()) : null;
        const dirs = typeof parsed.dir === "string" ? [parsed.dir] : defaultSearchDirs();
        const matches: Array<{ name: string; path: string; size: number; mimeType: string }> = [];
        for (const dir of dirs) {
          try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isFile()) continue;
              const nameLC = entry.name.toLowerCase();
              if (query && !nameLC.includes(query)) continue;
              const ext = extname(entry.name).toLowerCase();
              if (extFilter && ext !== extFilter) continue;
              const filePath = join(dir, entry.name);
              try {
                const stat = statSync(filePath);
                matches.push({ name: entry.name, path: filePath, size: stat.size, mimeType: FS_MIME_TYPES[ext] ?? "application/octet-stream" });
              } catch { /* skip */ }
            }
          } catch { /* map bestaat niet */ }
        }
        json(res, 200, { ok: true, matches });
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    if (url === "/fs/read-file" && method === "POST") {
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as { path?: string };
        if (typeof parsed.path !== "string" || !parsed.path.trim()) {
          json(res, 400, { ok: false, detail: "path is verplicht" });
          return;
        }
        const filePath = resolvePath(parsed.path);
        const content = readFileSync(filePath);
        if (content.length > 10 * 1024 * 1024) {
          json(res, 413, { ok: false, detail: "Bestand te groot (max 10 MB)" });
          return;
        }
        const ext = extname(filePath).toLowerCase();
        json(res, 200, {
          ok: true,
          path: filePath,
          filename: basename(filePath),
          mimeType: FS_MIME_TYPES[ext] ?? "application/octet-stream",
          size: content.length,
          content: content.toString("base64"),
        });
      } catch (e) {
        json(res, 500, { ok: false, detail: (e as Error).message });
      }
      return;
    }

    json(res, 404, { error: "Not found", endpoints: [
      "GET /status", "POST /capture", "POST /goal", "POST /navigate", "POST /adopt-tab", "GET /result",
      "POST /verify", "POST /save-session", "GET /assist", "POST /assist",
      "POST /cdp/capture/start", "POST /cdp/capture/stop", "POST /cdp/evaluate",
      "POST /cdp/response-body", "POST /cdp/replay", "POST /cdp/dom-dump",
      "POST /cdp/idor-compare", "POST /cdp/intercept/start", "POST /cdp/intercept/stop",
      "POST /cdp/intercept/continue", "GET /cdp/cookies", "POST /cdp/cookies/set",
      "POST /cdp/fill-spa", "POST /close-tabs", "POST /reload-extension",
      "POST /fs/list-files", "POST /fs/search-files", "POST /fs/read-file",
    ] });
  });

  server.listen(PORT, "127.0.0.1", () => {
    log(`HTTP trigger-API actief op http://127.0.0.1:${PORT}`);
  });

  server.on("error", (e: Error & { code?: string }) => {
    if (e.code === "EADDRINUSE") {
      log(`Poort ${PORT} al in gebruik — HTTP API niet gestart (companion al actief?)`);
    } else {
      log(`HTTP API fout: ${e.message}`);
    }
  });
}
