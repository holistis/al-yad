/**
 * E2E DONE-predicaat bewaker — twee aparte bewijzen:
 *
 * TEST A — mismatch-bewijs:
 *   Browser direct naar inventory.html (via /navigate, geen model).
 *   Model roept finish aan met done:[url-contains §§§DONE-GATE-TEST§§§].
 *   URL bevat die string NOOIT → gate registreert "mismatch" in stap-log.
 *   Verwacht: minstens 1 mismatch-entry. Status mag "fout" of "gestopt" zijn.
 *
 * TEST B — match-bewijs:
 *   Browser direct naar inventory.html?sort=hilo (via /navigate).
 *   Model roept finish aan met done:[url-contains ?sort=hilo].
 *   URL matcht WEL → gate registreert "match" + eindstatus "klaar".
 *
 * Samen bewijzen A+B dat de gate live in de browser beide paden correct aflegt.
 */

import { readFileSync } from "node:fs";

const API      = "http://localhost:3747";
const STEP_LOG = process.env["YAD_STEP_LOG_PATH"] ?? "C:\\Code\\yad-step-log.jsonl";

// ── helpers ────────────────────────────────────────────────────────────────

async function httpPost(path: string, body: unknown): Promise<unknown> {
  const { request } = await import("node:http");
  const json = JSON.stringify(body);
  const url  = new URL(API + path);
  return new Promise((resolve, reject) => {
    const r = request(
      {
        hostname: url.hostname,
        port:     Number(url.port || 80),
        path:     url.pathname,
        method:   "POST",
        headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) },
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

function doneChecksOf(steps: Array<Record<string, unknown>>, runId: string) {
  const runSteps   = steps.filter((s) => s["run"] === runId);
  const doneChecks = runSteps.filter((s) => (s["action"] as Record<string, unknown>)?.["kind"] === "_done-check");
  return {
    mismatches: doneChecks.filter((s) => (s["action"] as Record<string, unknown>)?.["verdict"] === "mismatch"),
    matches:    doneChecks.filter((s) => (s["action"] as Record<string, unknown>)?.["verdict"] === "match"),
  };
}

// ── test runner ────────────────────────────────────────────────────────────

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ${PASS} ${label}`); }
  else    { failed++; console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n\x1b[1mYAD DONE-predicaat bewaker — e2e (A=mismatch, B=match)\x1b[0m\n");

// ── Companion check ────────────────────────────────────────────────────────

const status = await httpGet("/status") as { ok?: boolean; connected?: boolean };
check("companion bereikbaar", status.ok === true);
check("Chrome verbonden",     status.connected === true);

if (!status.ok || !status.connected) {
  console.log(`\n${FAIL} Companion niet beschikbaar of Chrome niet verbonden. Stop.\n`);
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════════
// TEST A — mismatch-bewijs
//
// Setup: browser DIRECT naar inventory.html via /navigate (geen model).
// Mismatch-run: model roept finish aan met done:[url-contains §§§DONE-GATE-TEST§§§].
// Die waarde kan NOOIT in de URL verschijnen → gate logt mismatch.
// ══════════════════════════════════════════════════════════════════════════

console.log(`\n${INFO} TEST A — mismatch-bewijs`);
console.log(`  Setup: direct /navigate naar /inventory.html…`);

const navA = await httpPost("/navigate", { url: "https://www.saucedemo.com/inventory.html" }) as Record<string, unknown>;
check("setup A: browser naar inventory.html", navA["ok"] === true, `detail: ${JSON.stringify(navA)}`);

// Kleine pauze zodat de browser de navigatie kan afronden
await new Promise((r) => setTimeout(r, 1500));

console.log(`  Mismatch-run: model roept finish aan met onmogelijke done-predicate…`);

const linesBeforeMismatch = logLineCount(STEP_LOG);
const resultA = await httpPost("/goal", {
  goal:      'Jij hebt je taak voltooid: de inventaris-pagina is geladen. Roep nu finish aan met summary "inventaris geladen" en done:[{"type":"url-contains","value":"§§§DONE-GATE-TEST§§§"}]. Doe verder geen andere acties.',
  url:       "https://www.saucedemo.com/inventory.html",
  sync:      true,
  autonomy:  "auto",
  maxSteps:  4,
}) as Record<string, unknown>;

const stepsA = stepsSince(STEP_LOG, linesBeforeMismatch);
const runIdA = resultA["runId"] as string | undefined;
const { mismatches: mismatchesA } = doneChecksOf(stepsA, runIdA ?? "");

const doneCheckCountA = stepsA.filter(s => (s["action"] as Record<string,unknown>)?.["kind"] === "_done-check").length;
console.log(`  run-id: ${runIdA ?? "?"} | status: ${resultA["status"]} | done-checks: ${doneCheckCountA}`);
check("A: _done-check aanwezig in log",  doneCheckCountA >= 1);
check("A: minstens 1 mismatch — gate vuurde", mismatchesA.length >= 1, `mismatches: ${mismatchesA.length}`);

for (const m of mismatchesA) {
  const a = m["action"] as Record<string, unknown>;
  console.log(`    run=${m["run"]} step=${m["step"]} → ${a["verdict"]} (${a["matched"]}/${a["total"]})`);
}

// ══════════════════════════════════════════════════════════════════════════
// TEST B — match-bewijs
//
// Setup: browser DIRECT naar inventory.html (geen sort-param) via /navigate.
// Match-run: model sorteert producten hoog→laag (echte taak) en bevestigt
// daarna met done:[url-contains ?sort=hilo]. URL wordt ?sort=hilo na sortering
// → gate logt "match" en status = "klaar".
// ══════════════════════════════════════════════════════════════════════════

console.log(`\n${INFO} TEST B — match-bewijs`);
console.log(`  Setup: direct /navigate naar /inventory.html (startpositie zonder sort)…`);

const navB = await httpPost("/navigate", { url: "https://www.saucedemo.com/inventory.html" }) as Record<string, unknown>;
check("setup B: browser naar inventory.html", navB["ok"] === true, `detail: ${JSON.stringify(navB)}`);

await new Promise((r) => setTimeout(r, 1500));

console.log(`  Match-run: model navigeert naar ?sort=hilo en bevestigt daarna met done:[url-contains ?sort=hilo]…`);

const linesBeforeMatch = logLineCount(STEP_LOG);
const resultB = await httpPost("/goal", {
  goal:     'De URL moet https://www.saucedemo.com/inventory.html?sort=hilo zijn. Roep finish aan met summary "hilo bevestigd" en done:[{"type":"url-contains","value":"?sort=hilo"}]. Als de URL nog niet klopt, navigeer er dan EERST naartoe via de navigate-actie, en roep daarna finish aan met hetzelfde done-array.',
  url:      "https://www.saucedemo.com/inventory.html",
  sync:     true,
  autonomy: "auto",
  maxSteps: 6,
}) as Record<string, unknown>;

const stepsB  = stepsSince(STEP_LOG, linesBeforeMatch);
const runIdB  = resultB["runId"] as string | undefined;
const { matches: matchesB } = doneChecksOf(stepsB, runIdB ?? "");

const doneCheckCountB = stepsB.filter(s => (s["action"] as Record<string,unknown>)?.["kind"] === "_done-check").length;
console.log(`  run-id: ${runIdB ?? "?"} | status: ${resultB["status"]} | done-checks: ${doneCheckCountB}`);
check("B: _done-check aanwezig in log",         doneCheckCountB >= 1);
check("B: minstens 1 match — gate accepteerde", matchesB.length >= 1, `matches: ${matchesB.length}`);
check("B: eindstatus klaar",                    resultB["status"] === "klaar", `was: ${resultB["status"]}`);

for (const m of matchesB) {
  const a = m["action"] as Record<string, unknown>;
  console.log(`    run=${m["run"]} step=${m["step"]} → ${a["verdict"]} (${a["matched"]}/${a["total"]})`);
}

// ── Samenvatting ───────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Resultaat: ${passed} geslaagd, ${failed} mislukt\n`);

if (failed > 0) {
  console.log(`${FAIL} Test NIET geslaagd.\n`);
  process.exit(1);
} else {
  console.log(`${PASS} DONE-predicaat bewaker bewezen in e2e — mismatch EN match gelogd.\n`);
}
