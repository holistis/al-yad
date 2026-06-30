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
import type { BrainSession } from "./session.js";

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
        const parsed = JSON.parse(body) as { goal?: string; url?: string };
        if (typeof parsed.goal !== "string" || !parsed.goal.trim()) {
          json(res, 400, { ok: false, detail: "goal is verplicht" });
          return;
        }
        session.triggerGoal(parsed.goal, parsed.url);
        json(res, 200, { ok: true, goal: parsed.goal });
      } catch (e) {
        json(res, 400, { ok: false, detail: (e as Error).message });
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

    json(res, 404, { error: "Not found", endpoints: ["GET /status", "POST /capture", "POST /goal", "POST /navigate"] });
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
