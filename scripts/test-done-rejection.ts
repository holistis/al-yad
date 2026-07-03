/**
 * E2E rejection-gate test — bewijst dat de DONE-predicaat bewaker (Stap 4) een
 * vroegtijdige finish WEIGERT en de lus laat hervatten tot het doel echt bereikt is.
 *
 * Scenario:
 *  1. Browser start op /inventory.html (geen sort-param).
 *  2. Goal instrueert het model om DIRECT finish aan te roepen met done:[url-contains ?sort=hilo].
 *  3. Huidige URL bevat geen ?sort=hilo → url-contains → MISMATCH → finish geweigerd.
 *  4. Model navigeert naar /inventory.html?sort=hilo → finish opnieuw → MATCH → klaar.
 *
 * Verwacht resultaat in stap-log:
 *   _done-check  verdict:"mismatch"   ← gate vuurde
 *   _done-check  verdict:"match"      ← gate accepteerde na herstel
 *
 * Draai: pnpm exec tsx scripts/test-done-rejection.ts
 * Vereist: companion draait op localhost:3747, Chrome verbonden, saucedemo sessie actief
 *          (of de companion logt automatisch in als sessie-cookies aanwezig zijn).
 */

import { readFileSync, statSync } from "node:fs";
import { createConnection } from "node:net";

const API = "http://localhost:3747";
const STEP_LOG = process.env["YAD_STEP_LOG_PATH"] ?? "C:\\Code\\yad-step-log.jsonl";

// ── helpers ────────────────────────────────────────────────────────────────

async function post(path: string, body: unknown): Promise<unknown> {
  const json = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const url = new URL(API + path);
    const req = Object.assign(
      createConnection({ host: url.hostname, port: Number(url.port || 80) }),
      {},
    );
    // Use Node HTTP manually to avoid 'fetch' env dependency
    const { request } = await import("node:http");
    const r = request(
      { hostname: url.hostname, port: Number(url.port || 80), path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) } },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c; });
        res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
      },
    );
    r.on("error", reject);
    r.write(json);
    r.end();
  });
}

async function httpPost(path: string, body: unknown): Promise<unknown> {
  const { request } = await import("node:http");
  const json = JSON.stringify(body);
  const url = new URL(API + path);
  return new Promise((resolve, reject) => {
    const r = request(
      {
        hostname: url.hostname,
        port: Number(url.port || 80),
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
      },
    );
    r.on("error", reject);
    r.write(json);
    r.end();
  });
}

async function httpGet(path: string): Promise<unknown> {
  const { request } = await import("node:http");
  const url = new URL(API + path);
  return new Promise((resolve, reject) => {
    const r = request(
      { hostname: url.hostname, port: Number(url.port || 80), path: url.pathname, method: "GET" },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

function stepsSince(logPath: string, linesBefore: number): Array<Record<string, unknown>> {
  try {
    const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    return lines.slice(linesBefore).map((l) => {
      try { return JSON.parse(l) as Record<string, unknown>; } catch { return {}; }
    });
  } catch { return []; }
}

function logLineCount(logPath: string): number {
  try { return readFileSync(logPath, "utf8").split("\n").filter(Boolean).length; }
  catch { return 0; }
}

// ── test ───────────────────────────────────────────────────────────────────

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ${PASS} ${label}`); }
  else   { failed++; console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n\x1b[1mYAD DONE-predicaat rejection-gate — e2e test\x1b[0m\n");

// 1. Companion beschikbaarheid
console.log(`${INFO} Verbinden met companion op ${API}…`);
const status = await httpGet("/status") as { ok?: boolean; connected?: boolean };
check("companion bereikbaar", status.ok === true);
check("Chrome verbonden", status.connected === true);

if (!status.ok || !status.connected) {
  console.log(`\n${FAIL} Companion niet beschikbaar of Chrome niet verbonden. Stop.\n`);
  process.exit(1);
}

// 2. Navigeer browser naar startpositie: /inventory.html (zonder sort-param)
console.log(`\n${INFO} Stap 1: browser navigeren naar /inventory.html (startpositie zonder ?sort=hilo)…`);
const linesBeforeSetup = logLineCount(STEP_LOG);
const setupResult = await httpPost("/goal", {
  goal: "Navigeer naar https://www.saucedemo.com/inventory.html (als je al op de loginpagina bent, log dan in met standard_user / secret_sauce). Daarna finish direct zonder sortering.",
  url: "https://www.saucedemo.com/inventory.html",
  sync: true,
  autonomy: "auto",
}) as Record<string, unknown>;

check("setup-run voltooid", setupResult["status"] === "klaar" || setupResult["status"] === "gestopt",
  `status was: ${setupResult["status"]}`);
console.log(`  Browser op: ${(setupResult["startingUrl"] as string | undefined) ?? "onbekend"}`);

// 3. Rejection-gate test: instrueer model om EERST finish aan te roepen op foute URL
console.log(`\n${INFO} Stap 2: rejection-test starten…`);
console.log(`  Goal: finish met done:[url-contains ?sort=hilo] terwijl URL nog /inventory.html is`);
console.log(`  Verwacht: mismatch → model navigeert → match → klaar\n`);

const linesBefore = logLineCount(STEP_LOG);

const testResult = await httpPost("/goal", {
  goal: [
    "REJECTION-GATE TEST (geautomatiseerd):",
    "1. Roep DIRECT finish aan met done:[{\"type\":\"url-contains\",\"value\":\"?sort=hilo\"}].",
    "   De URL bevat nog geen ?sort=hilo, dus de finish wordt GEWEIGERD.",
    "2. Na de weigering: navigeer naar https://www.saucedemo.com/inventory.html?sort=hilo",
    "3. Roep finish opnieuw aan — nu matcht de URL en is de taak klaar.",
  ].join(" "),
  url: "https://www.saucedemo.com/inventory.html",
  sync: true,
  autonomy: "auto",
}) as Record<string, unknown>;

const steps = stepsSince(STEP_LOG, linesBefore);
const runId = testResult["runId"] as string | undefined;

console.log(`  run-id: ${runId ?? "?"}`);
console.log(`  status: ${testResult["status"]}`);
console.log(`  stappen in log: ${steps.length}`);

// 4. Verificatie stap-log
const runSteps = steps.filter((s) => s["run"] === runId);
const finishEntries = runSteps.filter((s) => (s["action"] as Record<string,unknown>)?.["kind"] === "_finish");
const doneChecks    = runSteps.filter((s) => (s["action"] as Record<string,unknown>)?.["kind"] === "_done-check");
const mismatches    = doneChecks.filter((s) => (s["action"] as Record<string,unknown>)?.["verdict"] === "mismatch");
const matches       = doneChecks.filter((s) => (s["action"] as Record<string,unknown>)?.["verdict"] === "match");

console.log(`\n${INFO} Stap-log verificatie:`);
check("_finish entry aanwezig in log", finishEntries.length > 0,
  `gevonden: ${finishEntries.length}`);
check("_done-check entry aanwezig in log", doneChecks.length > 0,
  `gevonden: ${doneChecks.length}`);
check("minstens 1 mismatch verdict — rejection-gate vuurde", mismatches.length >= 1,
  `mismatches: ${mismatches.length}, checks: ${doneChecks.length}`);
check("minstens 1 match verdict — gate accepteerde na herstel", matches.length >= 1,
  `matches: ${matches.length}`);
check("eindstatus klaar", testResult["status"] === "klaar",
  `was: ${testResult["status"]}`);

// 5. Samenvatting
console.log(`\n${"─".repeat(50)}`);
console.log(`Resultaat: ${passed} geslaagd, ${failed} mislukt\n`);

if (mismatches.length > 0) {
  console.log("Mismatch-entries (gate vuurde):");
  for (const m of mismatches) {
    const a = m["action"] as Record<string, unknown>;
    console.log(`  run=${m["run"]} step=${m["step"]} → ${a["verdict"]} (${a["matched"]}/${a["total"]}) detail=${m["detail"]}`);
  }
  console.log();
}

if (failed > 0) {
  console.log(`${FAIL} Test NIET geslaagd. Controleer companion-log en stap-log.\n`);
  process.exit(1);
} else {
  console.log(`${PASS} DONE-predicaat rejection-gate bewezen in e2e.\n`);
}
