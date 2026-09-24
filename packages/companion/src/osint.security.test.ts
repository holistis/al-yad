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
 * NIET gedekt (bewust, na de Majlis al-Muraqaba-audit van 2026-09-24):
 * - de echte, succesvolle /osint/read-page-navigatie tegen een levende x.com/
 *   discord.com-pagina, inclusief de post-redirect-hercontrole en de concurrency-
 *   limiet — dat zou echte chromium.launch()-aanroepen en/of een extern, niet-
 *   gecontroleerd systeem vereisen (traag, flaky). Wel volledig gedekt: alle
 *   validatie/weigerpaden VOOR chromium.launch() ooit wordt aangeroepen.
 * Wel toegevoegd na diezelfde audit: de auth-scheiding tussen /goal en /osint/*
 * (aparte sleutelpools) en de cookie-domain-smokkel-validatie.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(HERE, "..", "dist", "server-playwright.js");
const PORT = 37494;
const BASE = `http://127.0.0.1:${PORT}`;
const OSINT_KEY = "test-osint-key-1234567890";
const GOAL_ONLY_KEY = "test-goal-only-key-0987654321";

let proc: ChildProcess;
let sessionsDir: string;

async function wachtOpServer(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Let op: /status vereist HIER ook X-API-Key (checkExternalGate kent geen
      // uitzondering voor /status, anders dan de X-Yad-Token-poort in http-api.ts) —
      // zonder header krijg je hier altijd 401, nooit ok, en loopt dit in een timeout.
      const r = await fetch(`${BASE}/status`, { headers: { "X-API-Key": GOAL_ONLY_KEY } });
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
      // Bewust TWEE aparte sleutels, zoals na de auditfix: YAD_API_KEYS (voor /status,
      // /goal) en YAD_OSINT_API_KEYS (voor /osint/*) delen géén sleutel met elkaar.
      YAD_API_KEYS: GOAL_ONLY_KEY,
      YAD_OSINT_API_KEYS: OSINT_KEY,
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
  return { "Content-Type": "application/json", "X-API-Key": OSINT_KEY, ...extra };
}

describe("/osint/* — auth, EIGEN sleutelpool (YAD_OSINT_API_KEYS), los van /goal se YAD_API_KEYS", () => {
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

  it("weigert /osint/read-page zonder X-API-Key met 401 (de gevoeligste van de drie routes, moet ook zonder sleutel dicht zitten)", async () => {
    const r = await fetch(`${BASE}/osint/read-page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "x.com", url: "https://x.com/" }),
    });
    expect(r.status).toBe(401);
  });

  it("weigert /osint/read-page met een verkeerde sleutel met 401", async () => {
    const r = await fetch(`${BASE}/osint/read-page`, {
      method: "POST",
      headers: authHeaders({ "X-API-Key": "verkeerde-sleutel" }),
      body: JSON.stringify({ site: "x.com", url: "https://x.com/" }),
    });
    expect(r.status).toBe(401);
  });

  it("laat /osint/status door met de juiste OSINT-sleutel", async () => {
    const r = await fetch(`${BASE}/osint/status`, { headers: authHeaders() });
    expect(r.status).toBe(200);
  });

  it("een geldige /goal-sleutel werkt NIET voor /osint/* — de kern van de scheiding tussen de twee sleutelpools", async () => {
    const r = await fetch(`${BASE}/osint/status`, { headers: { "X-API-Key": GOAL_ONLY_KEY } });
    expect(r.status).toBe(401);
  });

  it("de OSINT-sleutel werkt op zijn beurt niet voor /goal (scheiding werkt in beide richtingen)", async () => {
    const r = await fetch(`${BASE}/goal`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ goal: "test" }),
    });
    expect(r.status).toBe(401);
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

  it("weigert een cookie met een 'domain' die niet bij de opgegeven site hoort (voorkomt cross-site cookie-smokkel)", async () => {
    const r = await fetch(`${BASE}/osint/import-session`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        site: "x.com",
        cookies: [
          { name: "sess", value: "echt" },
          { name: "planted", value: "kwaad", domain: "attacker-domain.example", path: "/" },
        ],
      }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.detail).toMatch(/bij de opgegeven site horen/);
  });

  it("weigert een cookie met een 'url' die niet bij de opgegeven site hoort", async () => {
    const r = await fetch(`${BASE}/osint/import-session`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "x.com", cookies: [{ name: "a", value: "b", url: "https://attacker.example/" }] }),
    });
    expect(r.status).toBe(400);
  });

  it("accepteert een cookie met een 'domain' die WEL bij de site hoort (inclusief het gebruikelijke leidende punt-voorvoegsel)", async () => {
    // Bewust discord.com i.p.v. x.com hier: de latere /osint/read-page-tests hieronder
    // gaan er specifiek van uit dat x.com GEEN sessie heeft (409-pad, nooit een echte
    // browser). Een succesvolle import voor x.com in DEZE test zou die aanname breken
    // en die tests per ongeluk een echte chromium.launch() laten doen.
    const r = await fetch(`${BASE}/osint/import-session`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "discord.com", cookies: [{ name: "sess2", value: "echt", domain: ".discord.com", path: "/" }] }),
    });
    expect(r.status).toBe(200);
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

describe("/osint/import-session — body-groottelimiet (Majlis al-Muraqaba-fix: onbeperkte buffering kon het hele proces laten crashen)", () => {
  it("geeft 413 (niet een crash, niet een hang) bij een body groter dan 10 MB", async () => {
    const groteBody = JSON.stringify({ site: "x.com", cookies: [{ name: "a", value: "x".repeat(11 * 1024 * 1024) }] });
    const r = await fetch(`${BASE}/osint/import-session`, {
      method: "POST",
      headers: authHeaders(),
      body: groteBody,
    });
    expect(r.status).toBe(413);
  }, 15_000);

  it("blijft normaal werken voor een kleine, geldige body (geen regressie door de limiet)", async () => {
    const r = await fetch(`${BASE}/osint/import-session`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ site: "discord.com", cookies: [{ name: "klein", value: "ok" }] }),
    });
    expect(r.status).toBe(200);
  });
});
