/**
 * YAD Benchmark Harness
 *
 * Meet het echte slagingspercentage van YAD op een curated task set.
 * Gefocust op de "geauthenticeerde web-research voor analisten" use case.
 *
 * Gebruik:
 *   pnpm benchmark                         # alle taken
 *   pnpm benchmark --limit 5               # eerste 5 taken
 *   pnpm benchmark --category web-research # één categorie
 *   pnpm benchmark --id bk-001             # één specifieke taak
 *   pnpm benchmark --headed                # zichtbare browser
 *   pnpm benchmark --tasks pad/naar/taken.jsonl  # eigen takenbestand
 *
 * Resultaat:
 *   - Live voortgang in terminal
 *   - JSON-rapport in data/benchmark-results-{timestamp}.json
 *   - Samenvatting met slagingspercentage aan het einde
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// ── Env laden ─────────────────────────────────────────────────────────────────

function loadEnv(): void {
  const path = resolve(repoRoot, ".env");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface BenchmarkTask {
  id: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  goal: string;
  startingUrl: string;
  domains: string[];
  expectedKeywords: string[];
  maxSteps: number;
}

type TaskVerdict = "pass" | "partial" | "fail" | "error";

interface TaskResult {
  id: string;
  category: string;
  difficulty: string;
  goal: string;
  verdict: TaskVerdict;
  /** 1.0 = volledig geslaagd, 0.5 = klaar maar niet verifieerbaar, 0.0 = mislukt */
  score: number;
  status: string;
  summary: string;
  steps: number;
  durationMs: number;
  failReason?: string;
  matchedKeywords: string[];
}

interface BenchmarkReport {
  runAt: string;
  totalTasks: number;
  passed: number;
  partial: number;
  failed: number;
  errors: number;
  passRate: number;
  fullPassRate: number;
  avgSteps: number;
  avgDurationMs: number;
  byCategory: Record<string, { total: number; passed: number; partial: number; score: number }>;
  byDifficulty: Record<string, { total: number; passed: number; score: number }>;
  results: TaskResult[];
}

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(): {
  tasksFile: string;
  limit?: number;
  from?: number;
  category?: string;
  id?: string;
  headed: boolean;
  concurrency: number;
  delayMs: number;
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  return {
    tasksFile: get("--tasks") ?? resolve(repoRoot, "data", "benchmark-tasks.jsonl"),
    limit: get("--limit") ? parseInt(get("--limit")!, 10) : undefined,
    from: get("--from") ? parseInt(get("--from")!, 10) : undefined,
    category: get("--category"),
    id: get("--id"),
    headed: args.includes("--headed"),
    concurrency: parseInt(get("--concurrency") ?? "1", 10),
    delayMs: parseInt(get("--delay") ?? "90", 10) * 1000,
  };
}

// ── Task loader ───────────────────────────────────────────────────────────────

async function loadTasks(
  file: string,
  opts: { limit?: number; from?: number; category?: string; id?: string },
): Promise<BenchmarkTask[]> {
  if (!existsSync(file)) throw new Error(`Takenbestand niet gevonden: ${file}`);
  const allTasks: BenchmarkTask[] = [];
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    const task = JSON.parse(t) as BenchmarkTask;
    if (opts.category && task.category !== opts.category) continue;
    if (opts.id && task.id !== opts.id) continue;
    allTasks.push(task);
  }
  const start = (opts.from ?? 1) - 1;
  const slice = allTasks.slice(start);
  return opts.limit ? slice.slice(0, opts.limit) : slice;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreTask(
  task: BenchmarkTask,
  status: string,
  summary: string,
): { verdict: TaskVerdict; score: number; matchedKeywords: string[] } {
  const isDone = status === "klaar";
  if (!isDone) return { verdict: "fail", score: 0, matchedKeywords: [] };

  if (task.expectedKeywords.length === 0) {
    // Geen verifieerbare verwachting — "klaar" is voldoende, partial score
    return { verdict: "partial", score: 0.5, matchedKeywords: [] };
  }

  const lowerSummary = summary.toLowerCase();
  const matched = task.expectedKeywords.filter((kw) =>
    lowerSummary.includes(kw.toLowerCase()),
  );

  if (matched.length === task.expectedKeywords.length) {
    return { verdict: "pass", score: 1.0, matchedKeywords: matched };
  } else if (matched.length > 0) {
    // Deels geverifieerd
    return {
      verdict: "partial",
      score: 0.5 + 0.5 * (matched.length / task.expectedKeywords.length),
      matchedKeywords: matched,
    };
  }

  return { verdict: "partial", score: 0.5, matchedKeywords: [] };
}

// ── Run één taak ──────────────────────────────────────────────────────────────

async function runTask(
  task: BenchmarkTask,
  opts: { headless: boolean; log: (m: string) => void },
): Promise<TaskResult> {
  // Lazy import zodat de rest snel laadt
  const { buildPool } = await import("../packages/companion/src/engine/pool.js");
  const { LlmRouter } = await import("../packages/companion/src/engine/router.js");
  const { AgentLoop } = await import("../packages/companion/src/agent/loop.js");
  const { CacheStore } = await import("../packages/companion/src/memory/cache-store.js");
  const { RecoveryStore } = await import("../packages/companion/src/memory/recovery-store.js");
  const { PlaywrightHand } = await import("../packages/companion/src/playwright-hand.js");
  const { ScopeGuard } = await import("../packages/companion/src/gate/scope-guard.js");

  const assignment = {
    id: task.id,
    description: task.goal.slice(0, 80),
    goal: task.goal,
    targetDomains: task.domains,
    maxActions: task.maxSteps,
    signedBy: "benchmark",
    createdAt: Date.now(),
  };

  const hand = new PlaywrightHand({ headless: opts.headless, log: opts.log });
  const startedAt = Date.now();

  try {
    await hand.init();

    const guard = new ScopeGuard(hand, assignment, opts.log);
    const pool = buildPool();
    const router = new LlmRouter(pool, { log: (m) => opts.log(`[motor] ${m}`) });
    const cacheStore = new CacheStore(resolve(repoRoot, "data"));
    const recoveryStore = new RecoveryStore(resolve(repoRoot, "data"));

    const loop = new AgentLoop(
      { chat: (req) => router.chat(req) },
      guard,
      {
        log: opts.log,
        maxSteps: task.maxSteps,
        autonomy: "auto",
        cacheStore,
        recoveryStore,
        isAborted: () => guard.violated,
        onStuck: async (reason) => {
          opts.log?.(`[stuck] ${reason.why} op ${reason.url} — LLM-herstelplan aanvragen`);
          const { generateRecoveryHint } = await import("../packages/companion/src/agent/recovery.js");
          const hint = await generateRecoveryHint({ chat: (req) => router.chat(req) }, reason);
          if (hint) opts.log?.(`[stuck] herstelplan: ${hint.slice(0, 120)}`);
          return hint;
        },
      },
    );

    // Navigeer eerst naar de startpagina
    const navResult = await guard.act({ kind: "navigate", url: task.startingUrl });
    if (!navResult.ok) {
      return {
        id: task.id,
        category: task.category,
        difficulty: task.difficulty,
        goal: task.goal,
        verdict: "error",
        score: 0,
        status: "nav-failed",
        summary: "",
        steps: 0,
        durationMs: Date.now() - startedAt,
        failReason: navResult.detail,
        matchedKeywords: [],
      };
    }

    const result = await loop.run(task.goal, task.maxSteps);
    const durationMs = Date.now() - startedAt;
    const summary = result.summary ?? "";
    const status = guard.violated ? "scope-violation" : result.status;

    const { verdict, score, matchedKeywords } = scoreTask(task, status, summary);

    return {
      id: task.id,
      category: task.category,
      difficulty: task.difficulty,
      goal: task.goal,
      verdict,
      score,
      status,
      summary,
      steps: result.steps,
      durationMs,
      failReason: verdict === "fail" ? (summary ? `status=${status} — ${summary}` : `status=${status}`) : undefined,
      matchedKeywords,
    };
  } catch (e) {
    return {
      id: task.id,
      category: task.category,
      difficulty: task.difficulty,
      goal: task.goal,
      verdict: "error",
      score: 0,
      status: "exception",
      summary: "",
      steps: 0,
      durationMs: Date.now() - startedAt,
      failReason: (e as Error).message,
      matchedKeywords: [],
    };
  } finally {
    await hand.close().catch(() => {});
  }
}

// ── Rapport bouwen ────────────────────────────────────────────────────────────

function buildReport(results: TaskResult[]): BenchmarkReport {
  const passed = results.filter((r) => r.verdict === "pass").length;
  const partial = results.filter((r) => r.verdict === "partial").length;
  const failed = results.filter((r) => r.verdict === "fail").length;
  const errors = results.filter((r) => r.verdict === "error").length;
  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const finishedSteps = results.filter((r) => r.steps > 0);

  const byCategory: BenchmarkReport["byCategory"] = {};
  const byDifficulty: BenchmarkReport["byDifficulty"] = {};

  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, passed: 0, partial: 0, score: 0 };
    byCategory[r.category]!.total++;
    if (r.verdict === "pass") byCategory[r.category]!.passed++;
    if (r.verdict === "partial") byCategory[r.category]!.partial++;
    byCategory[r.category]!.score += r.score;

    if (!byDifficulty[r.difficulty]) byDifficulty[r.difficulty] = { total: 0, passed: 0, score: 0 };
    byDifficulty[r.difficulty]!.total++;
    if (r.verdict === "pass") byDifficulty[r.difficulty]!.passed++;
    byDifficulty[r.difficulty]!.score += r.score;
  }

  return {
    runAt: new Date().toISOString(),
    totalTasks: results.length,
    passed,
    partial,
    failed,
    errors,
    passRate: results.length ? (passed + partial) / results.length : 0,
    fullPassRate: results.length ? passed / results.length : 0,
    avgSteps: finishedSteps.length
      ? finishedSteps.reduce((s, r) => s + r.steps, 0) / finishedSteps.length
      : 0,
    avgDurationMs: results.length
      ? results.reduce((s, r) => s + r.durationMs, 0) / results.length
      : 0,
    byCategory,
    byDifficulty,
    results,
  };
}

// ── Terminal output ───────────────────────────────────────────────────────────

function verdictIcon(v: TaskVerdict): string {
  return { pass: "✅", partial: "🟡", fail: "❌", error: "💥" }[v];
}

function printSummary(report: BenchmarkReport): void {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`YAD BENCHMARK RESULTATEN — ${report.runAt}`);
  console.log(line);
  console.log(`Totaal taken:      ${report.totalTasks}`);
  console.log(`✅ Volledig geslaagd:  ${report.passed} (${pct(report.fullPassRate)})`);
  console.log(`🟡 Gedeeltelijk:       ${report.partial}`);
  console.log(`❌ Mislukt:            ${report.failed}`);
  console.log(`💥 Fout:               ${report.errors}`);
  console.log(`\nSLAGINGSPERCENTAGE:  ${pct(report.passRate)} (pass + partial)`);
  console.log(`VOLLEDIG CORRECT:     ${pct(report.fullPassRate)}`);
  console.log(`Gem. stappen:         ${report.avgSteps.toFixed(1)}`);
  console.log(`Gem. tijd per taak:   ${(report.avgDurationMs / 1000).toFixed(1)}s`);
  console.log(`\nPer categorie:`);
  for (const [cat, data] of Object.entries(report.byCategory)) {
    const rate = data.total ? (data.passed + data.partial) / data.total : 0;
    console.log(`  ${cat.padEnd(22)} ${data.passed}/${data.total} volledig, score=${pct(data.score / data.total)}`);
    void rate;
  }
  console.log(`\nPer moeilijkheid:`);
  for (const [diff, data] of Object.entries(report.byDifficulty)) {
    console.log(`  ${diff.padEnd(10)} ${data.passed}/${data.total} volledig, score=${pct(data.score / data.total)}`);
  }
  console.log(line);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const RATE_LIMIT_SIGNALS = [
  "gratis ai-modellen",
  "alle providers faalden",
  "rate limit",
  "429",
  "quota",
];

function isRateLimitError(r: TaskResult): boolean {
  // Een rate-limit-fout komt terug als verdict "fail" (status="fout"), NIET als
  // verdict "error" — dat laatste is alleen voor een echte crash/exception. Deze
  // check op verdict "error" liet de retry hieronder dus nooit afgaan bij een
  // rate-limit, precies de fout die de solo-benchmark van 2026-08-28 verstopte
  // (11 van de 12 taken faalden stil, geen enkele retry vuurde af).
  const text = (r.summary ?? r.failReason ?? "").toLowerCase();
  return RATE_LIMIT_SIGNALS.some((s) => text.includes(s));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  loadEnv();

  const args = parseArgs();
  const tasks = await loadTasks(args.tasksFile, {
    limit: args.limit,
    from: args.from,
    category: args.category,
    id: args.id,
  });

  if (tasks.length === 0) {
    console.error("Geen taken gevonden met de gegeven filters.");
    process.exit(1);
  }

  const delaySec = Math.round(args.delayMs / 1000);
  console.log(`\n🔬 YAD BENCHMARK — ${tasks.length} taken, headed=${!args.headed}, delay=${delaySec}s`);
  console.log(`Takenbestand: ${args.tasksFile}`);
  if (args.category) console.log(`Filter categorie: ${args.category}`);
  if (args.from) console.log(`Startend bij taak ${args.from}`);
  console.log("─".repeat(60));

  const results: TaskResult[] = [];

  for (const [i, task] of tasks.entries()) {
    const prefix = `[${i + 1}/${tasks.length}] ${task.id} (${task.difficulty})`;
    console.log(`\n${prefix} — ${task.goal.slice(0, 70)}…`);

    const taskLog: string[] = [];
    const log = (m: string): void => {
      taskLog.push(m);
      process.stdout.write(`  ${m}\n`);
    };

    let result = await runTask(task, { headless: !args.headed, log });

    // Rate-limit retry: wacht 2 minuten en probeer één keer opnieuw.
    if (isRateLimitError(result)) {
      console.log(`  ⏳ Rate-limit geraakt — wacht 120s voor retry...`);
      await sleep(120_000);
      console.log(`  🔄 Retry: ${task.id}`);
      result = await runTask(task, { headless: !args.headed, log });
    }

    results.push(result);

    const icon = verdictIcon(result.verdict);
    console.log(`${icon} ${result.verdict.toUpperCase()} — status=${result.status}, stappen=${result.steps}, tijd=${(result.durationMs / 1000).toFixed(1)}s`);
    if (result.summary) console.log(`  Samenvatting: ${result.summary.slice(0, 120)}`);
    if (result.matchedKeywords.length) console.log(`  Gematcht: [${result.matchedKeywords.join(", ")}]`);
    if (result.failReason) console.log(`  Faalreden: ${result.failReason}`);

    // Pauze tussen taken — standaard 90s om per-minuut quota te laten resetten.
    if (i < tasks.length - 1) {
      process.stdout.write(`  ⏸ Wacht ${delaySec}s (quota cooldown)...\n`);
      await sleep(args.delayMs);
    }
  }

  const report = buildReport(results);
  printSummary(report);

  // Rapport opslaan
  const dataDir = resolve(repoRoot, "data");
  mkdirSync(dataDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = resolve(dataDir, `benchmark-results-${ts}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nRapport opgeslagen: ${reportPath}`);
}

main().catch((e: Error) => {
  console.error("[benchmark] Onverwachte fout:", e.message);
  process.exit(1);
});
