import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { request as httpRequest } from "node:http";

/**
 * Regressietest voor een externe security-audit (2026-09-08) die bevestigde:
 * geen auth op POST /goal, default YAD_HOST=0.0.0.0, en geen max body-grootte
 * in main-server.ts (het standalone-servermodus, "yadagent serve"). Dit dekt
 * de fix: default 127.0.0.1, DNS-rebinding-check via de Host-header, niet-lokaal
 * verkeer door checkExternalGate() (zelfde poort als http-api.ts), en een
 * 10 MB-limiet op de request-body die netjes een 413 teruggeeft in plaats van
 * de verbinding stil af te breken.
 *
 * Draait de ECHTE gecompileerde server (dist/main-server.js) als kindproces,
 * geen mock — anders bewijst deze test alleen dat de mock zich goed gedraagt.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(HERE, "..", "dist", "main-server.js");
const PORT = 37493;
const BASE = `http://127.0.0.1:${PORT}`;

let proc: ChildProcess;

/** fetch() in Node/undici verbiedt het overschrijven van de Host-header (forbidden
 *  header name, spec-conform net als in de browser). Om een vervalste Host-header
 *  echt te versturen — precies wat een DNS-rebinding-poging doet — moet dit via de
 *  lagere-niveau node:http-client, die deze restrictie niet kent. */
function requestMetHostHeader(path: string, host: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: PORT, path, method: "GET", headers: { Host: host } },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function wachtOpServer(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/status`);
      if (r.ok) return;
    } catch {
      // server nog niet klaar, opnieuw proberen
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("main-server.js kwam niet online binnen de tijdslimiet");
}

beforeAll(async () => {
  proc = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      YAD_PORT: String(PORT),
      YAD_HOST: "127.0.0.1",
      YAD_LOKAAL: "1",
    },
    stdio: "pipe",
  });
  await wachtOpServer();
}, 20_000);

afterAll(() => {
  proc?.kill();
});

describe("main-server.ts — exposure-fixes uit de externe audit", () => {
  it("bindt aan 127.0.0.1 en antwoordt normaal met een geldige Host-header", async () => {
    const r = await fetch(`${BASE}/status`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
  });

  it("weigert een vervalste Host-header (DNS-rebinding-signaal) met 403", async () => {
    const r = await requestMetHostHeader("/status", "evil.example.com");
    expect(r.status).toBe(403);
  });

  it("geeft een nette 413 terug bij een request-body groter dan 10 MB, en breekt de verbinding niet stil af", async () => {
    const groteBody = "x".repeat(11 * 1024 * 1024);
    const r = await fetch(`${BASE}/goal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: groteBody,
    });
    expect(r.status).toBe(413);
    const body = await r.json();
    expect(body.ok).toBe(false);
  });

  it("blijft normaal valideren voor een kleine, geldige request (geen regressie op bestaand gedrag)", async () => {
    const r = await fetch(`${BASE}/goal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "" }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.detail).toMatch(/goal.*verplicht/i);
  });

  it("geeft 400 (niet 413 of een crash) bij ongeldige JSON in een kleine body", async () => {
    const r = await fetch(`${BASE}/goal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "dit-is-geen-json",
    });
    expect(r.status).toBe(400);
  });
});
