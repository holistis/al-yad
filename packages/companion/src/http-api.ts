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
 *
 * Beveiliging (Exposure-check):
 *   - Bindt ALLEEN aan 127.0.0.1 — niet bereikbaar van buiten de machine
 *   - Weigert requests waarvan remoteAddress niet 127.0.0.1 of ::1 is
 *   - Geen auth nodig: alleen lokale processen (Claude Code) kunnen dit bereiken
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { readSteps } from "./history/step-reader.js";
import { verifySteps } from "./verify/verifier.js";
import type { BrainSession } from "./session.js";
import type { Substate } from "./agent/substate.js";

const PORT = 3747;

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

export function startHttpApi(session: BrainSession, log: (m: string) => void): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const addr = req.socket.remoteAddress;
    if (addr !== "127.0.0.1" && addr !== "::1" && addr !== "::ffff:127.0.0.1") {
      json(res, 403, { error: "Forbidden — alleen localhost" });
      return;
    }

    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (url === "/status" && method === "GET") {
      json(res, 200, { ok: true, connected: session.isConnected(), version: "0.1.0" });
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
        const parsed = JSON.parse(body) as { goal?: string; url?: string; sync?: boolean; maxSteps?: number; autonomy?: "confirm" | "auto"; substates?: Substate[] };
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
        if (parsed.sync === true) {
          // Wacht op het resultaat zodat de Planner (Claude Code) het kan verwerken.
          const result = await session.runGoalSync(rawGoal, {
            maxSteps: typeof parsed.maxSteps === "number" ? parsed.maxSteps : undefined,
            startingUrl: parsed.url,
            autonomy: parsed.autonomy === "auto" ? "auto" : undefined,
            substates: Array.isArray(parsed.substates) ? parsed.substates : undefined,
          });
          json(res, 200, { ok: true, ...result });
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
          expression: parsed.expression.slice(0, 4_000),
          tabId: typeof parsed.tabId === "number" ? parsed.tabId : undefined,
        }, 15_000);
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

    json(res, 404, { error: "Not found", endpoints: ["GET /status", "POST /capture", "POST /goal", "POST /navigate", "GET /result", "POST /verify", "POST /save-session", "GET /assist", "POST /assist", "POST /cdp/capture/start", "POST /cdp/capture/stop", "POST /cdp/evaluate", "POST /cdp/response-body", "POST /cdp/replay"] });
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
