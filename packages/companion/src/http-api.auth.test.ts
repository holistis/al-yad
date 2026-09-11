/**
 * Regressietest voor de externe adversariale review (2026-09-11) die bevestigde: de
 * lokale HTTP-API had geen enkele authenticatie op het loopback-pad. Een geldig
 * 127.0.0.1-adres plus een kloppende Host-header bewijst alleen dat het TCP-pakket van
 * deze machine komt, niet WIE het stuurde — elke andere tab in dezelfde Chrome, of elk
 * ander lokaal proces, kon voorheen exact hetzelfde als de bedoelde aanroeper (Claude
 * Code). Dit dekt de fix: een eenmalig gegenereerd, persistent token dat via de header
 * X-Yad-Token meegestuurd moet worden voor elk endpoint behalve GET /status.
 *
 * Draait de echte, ongemockte server via startHttpApi() met een echte poort, geen
 * gemockte node:http — anders bewijst deze test alleen dat de mock zich braaf gedraagt.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrainSession } from "./session.js";

const PORT = 37494;
const BASE = `http://127.0.0.1:${PORT}`;
let dataDir: string;
let token: string;

function fakeSession(): BrainSession {
  // De auth-check draait vóór elke route-specifieke logica; alleen /status wordt hier
  // echt bereikt (voor de opstart-polling en de bewuste geen-token-uitzondering), de
  // overige testgevallen worden al bij de auth-poort zelf afgewezen.
  return {
    isConnected: () => false,
    stilteMs: () => 0,
  } as unknown as BrainSession;
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "yad-http-api-auth-test-"));
  process.env["YAD_DATA_DIR"] = dataDir;
  process.env["YAD_PORT"] = String(PORT);
  const { startHttpApi } = await import("./http-api.js");
  startHttpApi(fakeSession(), () => {});
  // Het token wordt synchroon tijdens startHttpApi() weggeschreven, vóór listen() klaar
  // is; een korte polling-wacht op de server zelf is genoeg om ook het bestand te vinden.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/status`);
      if (r.ok) break;
    } catch { /* server nog niet klaar */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  token = readFileSync(join(dataDir, "companion-token.txt"), "utf8").trim();
}, 15_000);

afterAll(() => {
  delete process.env["YAD_DATA_DIR"];
  delete process.env["YAD_PORT"];
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* opruimen mag falen */ }
});

describe("http-api.ts — auth-token uit de adversariale review", () => {
  it("genereert een echt, lang token-bestand met beperkte permissies", () => {
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("laat GET /status zonder token door (bewuste uitzondering, geen actie, geen geheim)", async () => {
    const r = await fetch(`${BASE}/status`);
    expect(r.status).toBe(200);
  });

  it("weigert POST /goal zonder token met 401, precies het gat dat de review vond", async () => {
    const r = await fetch(`${BASE}/goal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "test" }),
    });
    expect(r.status).toBe(401);
  });

  it("weigert POST /cdp/evaluate zonder token, ook al lijkt de aanvraag verder geldig", async () => {
    const r = await fetch(`${BASE}/cdp/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ expression: "1+1" }),
    });
    expect(r.status).toBe(401);
  });

  it("weigert een fout token net zo hard als een ontbrekend token", async () => {
    const r = await fetch(`${BASE}/goal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Yad-Token": "duidelijk-fout-token" },
      body: JSON.stringify({ goal: "test" }),
    });
    expect(r.status).toBe(401);
  });

  it("komt voorbij de auth-poort met het juiste token (verdere afwijzing, als die er is, komt dus ergens anders vandaan)", async () => {
    const r = await fetch(`${BASE}/goal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Yad-Token": token },
      body: JSON.stringify({ goal: "" }),
    });
    expect(r.status).not.toBe(401);
  });
});
