import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * Regressietest voor de /osint/*-routes (generalisatie van /yc/import-session,
 * 2026-09-24) op server-playwright.ts: het externe pad dat de VPS onafhankelijk
 * van het laptop-Chrome-profiel van de koning een X/Discord-sessie laat hergebruiken.
 *
 * Draait de ECHTE gecompileerde server (dist/server-playwright.js) als kindproces,
 * geen mock — zelfde discipline als main-server.security.test.ts.
 *
 * NIET gedekt: de echte, succesvolle /osint/read-page-navigatie tegen een levende
 * x.com/discord.com-pagina. Dat zou een test afhankelijk maken van een extern,
 * niet-gecontroleerd systeem (traag, flaky, en een echte netwerkaanroep vanuit een
 * testrun). Wel volledig gedekt: alle validatie/weigerpaden VOOR chromium.launch()
 * ooit wordt aangeroepen (site-allowlist, SSRF-host-check, ontbrekende sessie) —
 * dat is precies waar de beveiligingslogica zit.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(HERE, "..", "dist", "server-playwright.js");
const PORT = 37494;
const BASE = `http://127.0.0.1:${PORT}`;
const API_KEY = "test-osint-key-1234567890";

let proc: ChildProcess;
let sessionsDir: string;

async function wachtOpServer(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Let op: /status vereist HIER ook X-API-Key (checkExternalGate kent geen
      // uitzondering voor /status, anders dan de X-Yad-Token-poort in http-api.ts) —
      // zonder header krijg je hier altijd 401, nooit ok, en loopt dit in een timeout.
      const r = await fetch(`${BASE}/status`, { headers: { "X-API-Key": API_KEY } });
      if (r.ok) return;
    } catch {
      // server nog niet klaar, opnieuw proberen
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server-playwright.js kwam niet online binnen de tijdslimiet");
}

beforeAll(async () => {
  sessionsDir = mkdtempSync(join(tmpdir(), "yad-osint-test-"));
  proc = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      YAD_SERVER_PORT: String(PORT),
      YAD_API_KEYS: API_KEY,
      YAD_OSINT_SESSIONS_DIR: sessionsDir,
    },
    stdio: "pipe",
  });
  await wachtOpServer();
}, 20_000);

afterAll(() => {
  proc?.kill();
  try { rmSync(sessionsDir, { recursive: true, force: true }); } catch { /* opruimen mag falen */ }
});

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "Content-Type": "application/json", "X-API-Key": API_KEY, ...extra };
}

describe("/osint/* — auth (dezelfde poort als /goal, geen los geheim)", () => {
  it("weigert /osint/status zonder X-API-Key met 401", async () => {
    const r = await fetch(`${BASE}/osint/status`);
    expect(r.status).toBe(401);
  });

  it("weigert /osint/import-session met een verkeerde sleutel met 401", async () => {
    const r = await fetch(`${BASE}/osint/import-session`, {
      method: "POST",
      headers: authHeaders({ "X-API-Key": "verkeerde-sleutel" }),
      body: JSON.stringify({ site: "x.com", cookies: [{ name: "a", value: "b" }] }),
    });
    expect(r.status).toBe(401);
  });

  it("laat /osint/status door met de juiste sleutel", async () => {
    const r = await fetch(`${BASE}/osint/status`, { headers: authHeaders() });
    expect(r.status).toBe(200);
  });
});

describe("/osint/import-session — validatie", () => {
  it("weigert een onbekende site", async () => {
    const r = await fetch(`${BASE}/osint/import-session`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "facebook.com", cookies: [{ name: "a", value: "b" }] }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.detail).toMatch(/x\.com.*discord\.com|discord\.com.*x\.com/);
  });

  it("weigert een lege cookies-array", async () => {
    const r = await fetch(`${BASE}/osint/import-session`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "x.com", cookies: [] }),
    });
    expect(r.status).toBe(400);
  });

  it("weigert meer dan 200 cookies (waarschijnlijk het verkeerde bestand)", async () => {
    const teVeel = Array.from({ length: 201 }, (_, i) => ({ name: `c${i}`, value: "v" }));
    const r = await fetch(`${BASE}/osint/import-session`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "x.com", cookies: teVeel }),
    });
    expect(r.status).toBe(400);
  });

  it("weigert een cookie zonder 'value'", async () => {
    const r = await fetch(`${BASE}/osint/import-session`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "x.com", cookies: [{ name: "a" }] }),
    });
    expect(r.status).toBe(400);
  });

  it("accepteert een geldige site+cookies en de sessie is daarna zichtbaar in /osint/status", async () => {
    const r = await fetch(`${BASE}/osint/import-session`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "discord.com", cookies: [{ name: "session", value: "abc123" }] }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ ok: true, site: "discord.com", count: 1 });

    const statusR = await fetch(`${BASE}/osint/status`, { headers: authHeaders() });
    const statusBody = await statusR.json();
    const discord = statusBody.sites.find((s: { site: string }) => s.site === "discord.com");
    expect(discord).toMatchObject({ hasSession: true, cookieCount: 1 });
  });
});

describe("/osint/read-page — weigeringen VOOR er ooit een browser opstart", () => {
  it("weigert een onbekende site", async () => {
    const r = await fetch(`${BASE}/osint/read-page`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "facebook.com", url: "https://facebook.com/" }),
    });
    expect(r.status).toBe(400);
  });

  it("weigert een niet-https url", async () => {
    const r = await fetch(`${BASE}/osint/read-page`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "x.com", url: "http://x.com/" }),
    });
    expect(r.status).toBe(400);
  });

  it("weigert een url die niet bij de opgegeven site hoort (SSRF-bescherming — de kern van deze route)", async () => {
    const r = await fetch(`${BASE}/osint/read-page`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "x.com", url: "https://169.254.169.254/latest/meta-data/" }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.detail).toMatch(/hoort niet bij site/);
  });

  it("weigert een echte subdomain-poging naar een ANDER doel dan de opgegeven site (bv. x.com.evil.example)", async () => {
    const r = await fetch(`${BASE}/osint/read-page`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "x.com", url: "https://x.com.evil.example/" }),
    });
    expect(r.status).toBe(400);
  });

  it("staat een echte subdomain van de opgegeven site WEL toe qua host-check (faalt pas later op ontbrekende sessie)", async () => {
    const r = await fetch(`${BASE}/osint/read-page`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "x.com", url: "https://api.x.com/" }),
    });
    // Host-check is voorbij (geen 400 met "hoort niet bij site"); valt op de
    // volgende check (geen geïmporteerde sessie voor x.com in deze testrun) met 409.
    expect(r.status).toBe(409);
  });

  it("geeft 409 als er nog geen sessie is geïmporteerd voor de site", async () => {
    const r = await fetch(`${BASE}/osint/read-page`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "x.com", url: "https://x.com/" }),
    });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.detail).toMatch(/geen opgeslagen sessie/);
  });
});
