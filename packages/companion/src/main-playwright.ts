/**
 * main-playwright — CLI-runner voor Yad zonder Chrome-extensie.
 *
 * GEBRUIK:
 *   node dist/main-playwright.js --assignment assignment.json [--headless] [--session session-A.json]
 *   node dist/main-playwright.js --goal "tekst" --domains "example.com,api.example.com" [--session ...]
 *
 * VEILIGHEID:
 *   1. validateAssignment() weigert ongeldige of te brede toewijzingen.
 *   2. ScopeGuard blokkeert elke actie buiten de toewijzingsdomeinen.
 *   3. De harde deny-lijst (/payment, /checkout, ...) is altijd actief.
 *   4. Elke run wordt gelogd in run-history.jsonl.
 *
 * RESULTAAT:
 *   - Uitvoer naar stdout (voortgangs-updates + eindresultaat)
 *   - Exit code 0 = klaar, 1 = fout of scope-overtreding
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { loadEnvFile } from "./env.js";
import { buildPool } from "./engine/pool.js";
import { LlmRouter } from "./engine/router.js";
import { AgentLoop } from "./agent/loop.js";
import { CacheStore } from "./memory/cache-store.js";
import { RunHistoryStore } from "./history/run-history.js";
import { PlaywrightHand } from "./playwright-hand.js";
import { ScopeGuard } from "./gate/scope-guard.js";
import { validateAssignment, type Assignment } from "./gate/assignment.js";

const log = (m: string): void => console.log(`[yad-pw] ${m}`);

interface ParsedCookie {
  name: string;
  value: string;
}

/** Zet een cookie-header-string om naar naam/waarde-paren. */
function parseCookieHeader(header: string): ParsedCookie[] {
  return header
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .flatMap((pair): ParsedCookie[] => {
      const eq = pair.indexOf("=");
      if (eq < 0) return [];
      const name = pair.slice(0, eq).trim();
      if (!name) return [];
      return [{ name, value: pair.slice(eq + 1).trim() }];
    });
}

function parseArgs(): {
  assignmentFile?: string;
  goal?: string;
  domains?: string[];
  sessionFile?: string;
  headless: boolean;
  maxActions: number;
  recordVideoDir?: string;
  demoCursor: boolean;
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const has = (flag: string): boolean => args.includes(flag);

  const domains = get("--domains")
    ?.split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  return {
    assignmentFile: get("--assignment"),
    goal: get("--goal"),
    domains,
    sessionFile: get("--session"),
    headless: !has("--headed"),
    maxActions: parseInt(get("--max-actions") ?? "100", 10),
    recordVideoDir: get("--record-video"),
    demoCursor: has("--demo-cursor"),
  };
}

function loadAssignment(args: ReturnType<typeof parseArgs>): Assignment {
  if (args.assignmentFile) {
    if (!existsSync(args.assignmentFile)) {
      throw new Error(`Assignment-bestand niet gevonden: ${args.assignmentFile}`);
    }
    return JSON.parse(readFileSync(args.assignmentFile, "utf-8")) as Assignment;
  }

  if (!args.goal || !args.domains?.length) {
    throw new Error(
      "Geef --assignment <bestand> of --goal <tekst> + --domains <domein1,domein2>.",
    );
  }

  return {
    id: `cli-${Date.now()}`,
    description: `CLI-toewijzing: ${args.goal.slice(0, 60)}`,
    goal: args.goal,
    targetDomains: args.domains,
    maxActions: args.maxActions,
    signedBy: "king",
    createdAt: Date.now(),
  };
}

async function main(): Promise<void> {
  loadEnvFile();

  const args = parseArgs();
  const assignment = loadAssignment(args);

  // ── Pre-run veiligheidscheck (muraqib-al-aman in code) ──────────────────────
  const validation = validateAssignment(assignment);
  if (!validation.ok) {
    console.error("\n🛑 PRE-RUN VALIDATIE MISLUKT — run geweigerd:\n");
    for (const err of validation.errors) {
      console.error(`  • ${err}`);
    }
    console.error("\nPas de toewijzing aan en probeer opnieuw.\n");
    process.exit(1);
  }

  log(`Toewijzing gevalideerd: "${assignment.id}"`);
  log(`Doel: ${assignment.goal}`);
  log(`Domeinen: ${assignment.targetDomains.join(", ")}`);
  log(`Max acties: ${assignment.maxActions}`);
  if (args.demoCursor && !assignment.targetDomains.every((d) => d === "localhost" || d.endsWith(".localhost"))) {
    log("⚠️  --demo-cursor staat aan buiten een localhost-doelwit — dit vertraagt elke klik/typ-actie zichtbaar (bedoeld voor opnames, niet voor echte runs).");
  }
  log("─".repeat(60));

  // ── Sessie-injectie (optioneel) ─────────────────────────────────────────────
  let cookies: Array<{ name: string; value: string; domain: string }> | undefined;
  if (args.sessionFile) {
    if (!existsSync(args.sessionFile)) {
      log(`Waarschuwing: sessie-bestand niet gevonden: ${args.sessionFile} (doorgaan zonder sessie)`);
    } else {
      try {
        const sess = JSON.parse(readFileSync(args.sessionFile, "utf-8")) as {
          cookieHeader?: string;
        };
        if (sess.cookieHeader) {
          const parsed = parseCookieHeader(sess.cookieHeader);
          const domain = assignment.targetDomains[0] ?? "";
          cookies = parsed.map((c) => ({ ...c, domain }));
          log(`${cookies.length} cookies geladen uit ${args.sessionFile}`);
        }
      } catch (e) {
        log(`Sessie-laadfout: ${(e as Error).message} (doorgaan zonder sessie)`);
      }
    }
  }

  // ── Playwright + ScopeGuard opstarten ──────────────────────────────────────
  const hand = new PlaywrightHand({
    headless: args.headless,
    log,
    cookies,
    recordVideoDir: args.recordVideoDir,
    demoCursor: args.demoCursor,
  });
  await hand.init();

  const guard = new ScopeGuard(hand, assignment, log);
  const pool = buildPool();
  const router = new LlmRouter(pool, { log: (m) => log(`[motor] ${m}`) });
  const cacheStore = new CacheStore();
  const runHistory = new RunHistoryStore();

  log(`Motor actief: ${pool.map((p) => p.name).join(", ")} (${pool.length} providers)`);
  log("─".repeat(60));

  const startedAt = Date.now();
  const loop = new AgentLoop(
    { chat: (req) => router.chat(req) },
    guard,
    {
      log,
      maxSteps: assignment.maxActions,
      autonomy: "auto",
      cacheStore,
      // Scope-overtreding stopt de run meteen bij de volgende stap.
      isAborted: () => guard.violated,
    },
  );

  let exitCode = 0;
  try {
    const result = await loop.run(assignment.goal);

    log("─".repeat(60));
    if (guard.violated) {
      log(`🛑 Run beëindigd door scope-overtreding: ${guard.violationDetail}`);
      exitCode = 1;
    } else {
      log(`✅ Run voltooid: ${result.status} — ${result.steps} stappen`);
      if (result.summary) log(`Resultaat: ${result.summary}`);
    }

    runHistory.append({
      id: assignment.id,
      goal: assignment.goal,
      status: guard.violated ? "scope-violation" : result.status,
      steps: result.steps,
      summary: result.summary,
      startedAt,
      finishedAt: Date.now(),
      startingUrl: assignment.targetDomains[0] ? `https://${assignment.targetDomains[0]}/` : undefined,
    });
  } catch (e) {
    log(`Fout: ${(e as Error).message}`);
    exitCode = 1;
  } finally {
    if (args.demoCursor && args.recordVideoDir) {
      try {
        mkdirSync(args.recordVideoDir, { recursive: true });
        const timelinePath = join(args.recordVideoDir, "timeline.json");
        writeFileSync(timelinePath, JSON.stringify(hand.demoTimeline, null, 2));
        log(`Demo-tijdlijn geschreven: ${timelinePath} (${hand.demoTimeline.length} momenten)`);
      } catch (e) {
        log(`Kon demo-tijdlijn niet wegschrijven: ${(e as Error).message}`);
      }
    }
    await hand.close();
    if (args.recordVideoDir) {
      await waitForVideoFlush(args.recordVideoDir, log);
    }
  }

  process.exit(exitCode);
}

/**
 * Playwright's eigen video-encoder-subproces flusht na browser.close() nog even door.
 * process.exit() direct daarna sneed het .webm-bestand eerder af ("File ended prematurely").
 * In plaats van een vaste pauze te gokken: pollen tot de bestandsgrootte twee metingen op
 * rij niet meer groeit, met een harde bovengrens als vangnet.
 */
async function waitForVideoFlush(dir: string, log: (m: string) => void, maxMs = 8_000): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const latestWebm = (): string | null => {
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(".webm"));
      const last = files.at(-1);
      return last ? join(dir, last) : null;
    } catch {
      return null;
    }
  };

  const started = Date.now();
  let lastSize = -1;
  let stableCount = 0;
  while (Date.now() - started < maxMs) {
    const file = latestWebm();
    if (!file) {
      await sleep(200);
      continue;
    }
    const size = statSync(file).size;
    if (size === lastSize && size > 0) {
      stableCount++;
      if (stableCount >= 2) {
        log(`Video-opname stabiel (${size} bytes) na ${Date.now() - started}ms.`);
        return;
      }
    } else {
      stableCount = 0;
    }
    lastSize = size;
    await sleep(250);
  }
  log(`Video-flush-check bereikte de bovengrens van ${maxMs}ms zonder stabiele bestandsgrootte — mogelijk nog niet volledig geschreven.`);
}

main().catch((e: Error) => {
  console.error("[yad-pw] Onverwachte fout:", e.message);
  process.exit(1);
});
