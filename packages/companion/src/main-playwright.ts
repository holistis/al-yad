/**
 * main-playwright — CLI-runner voor Yad zonder Chrome-extensie.
 *
 * GEBRUIK:
 *   node dist/main-playwright.js --assignment assignment.json [--headless] [--session session-A.json]
 *   node dist/main-playwright.js --goal "tekst" --domains "www.REDACTED.nl,api.REDACTED.nl" [--session ...]
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

import { readFileSync, existsSync } from "node:fs";
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
import { REDACTEDSessionReader } from "./key/session-reader.js";

const log = (m: string): void => console.log(`[yad-pw] ${m}`);

function parseArgs(): {
  assignmentFile?: string;
  goal?: string;
  domains?: string[];
  sessionFile?: string;
  headless: boolean;
  maxActions: number;
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
          const { parseCookieHeader } = await import("./key/session-reader.js");
          const parsed = parseCookieHeader(sess.cookieHeader);
          const domain = assignment.targetDomains[0] ?? "";
          cookies = parsed.map((c) => ({ ...c, domain }));
          log(`${cookies.length} cookies geladen uit ${args.sessionFile}`);
        }
      } catch (e) {
        log(`Sessie-laadfout: ${(e as Error).message} (doorgaan zonder sessie)`);
      }
    }
  } else {
    // Probeer automatisch via REDACTEDSessionReader (GHANIMA_PATH vereist).
    const reader = new REDACTEDSessionReader();
    const firstDomain = assignment.targetDomains[0];
    if (firstDomain) {
      const session = reader.findForUrl(`https://${firstDomain}/`);
      if (session?.cookies.length) {
        cookies = session.cookies.map((c) => ({ ...c, domain: firstDomain }));
        log(`Auto-sessie geladen voor ${session.brand}: ${cookies.length} cookies`);
      }
    }
  }

  // ── Playwright + ScopeGuard opstarten ──────────────────────────────────────
  const hand = new PlaywrightHand({ headless: args.headless, log, cookies });
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
    await hand.close();
  }

  process.exit(exitCode);
}

main().catch((e: Error) => {
  console.error("[yad-pw] Onverwachte fout:", e.message);
  process.exit(1);
});
