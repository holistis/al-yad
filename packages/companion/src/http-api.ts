/**
 * Lokale HTTP trigger-API — luistert op 127.0.0.1:3747.
 *
 * Hierdoor kan Claude Code (CLI) direct commando's sturen naar de companion
 * zonder dat de gebruiker iets hoeft te klikken in de extensie.
 *
 * Endpoints:
 *   GET  /status          → { ok, connected }
 *   POST /capture         → { ok, path } (activeert page-capture in Chrome)
 *   POST /goal            → { ok } (body: { goal: string, url?: string })
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
        if (parsed.sync === true) {
          // Wacht op het resultaat zodat de Planner (Claude Code) het kan verwerken.
          const result = await session.runGoalSync(parsed.goal, {
            maxSteps: typeof parsed.maxSteps === "number" ? parsed.maxSteps : undefined,
            startingUrl: parsed.url,
            autonomy: parsed.autonomy === "auto" ? "auto" : undefined,
            substates: Array.isArray(parsed.substates) ? parsed.substates : undefined,
          });
          json(res, 200, { ok: true, ...result });
        } else {
          // Fire-and-forget: resultaat gaat naar de extension sidepanel (bestaand gedrag).
          session.triggerGoal(parsed.goal, parsed.url);
          json(res, 200, { ok: true, goal: parsed.goal });
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

    json(res, 404, { error: "Not found", endpoints: ["GET /status", "POST /capture", "POST /goal", "POST /navigate", "GET /result", "POST /verify", "POST /save-session", "GET /assist", "POST /assist"] });
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
