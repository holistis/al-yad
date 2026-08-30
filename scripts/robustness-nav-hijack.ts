/**
 * Robuustheidstest: onverwachte paginawisseling, herhaald.
 *
 * WAAROM DIT SCRIPT BESTAAT
 * Research Log #2 (site/blog-benchmark-browseruse.html) noemt één geval waarin Yad
 * tijdens de benchmark een onverwachte paginanavigatie tegenkwam en zichzelf herstelde.
 * Een publieke reactie op de Hashnode-republicatie wees er terecht op dat één geval
 * niets bewijst over hoe vaak dat herstel lukt — dat vraagt een test die de storing
 * expres en herhaald veroorzaakt, en het herstelpercentage meet.
 *
 * WAT HET DOET
 * Draait dezelfde benchmarktaak (bk-004: navigeer naar de Mystery-categorie op
 * books.toscrape.com, meld de titel van het eerste boek) een aantal keer. Bij elke run
 * wordt, zodra de agent zijn EERSTE echte stap heeft gezet, de pagina buiten de agent-lus
 * om geforceerd weggenavigeerd naar een neutrale, onverwante pagina (example.com) — dat
 * simuleert exact de klasse fout uit de blogpost: de agent kijkt weer, en de pagina waar
 * hij op stond is ineens iets anders. Geen enkele geprivilegieerde actie, gewoon een
 * kale race tussen "agent handelt" en "pagina verandert alsnog".
 *
 * Gebruik:
 *   pnpm robustness-nav-hijack                 # standaard 8 herhalingen
 *   pnpm robustness-nav-hijack --repeats 12
 *   pnpm robustness-nav-hijack --headed        # zichtbare browser
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

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

const TASK = {
  id: "bk-004",
  goal: "Ga naar books.toscrape.com, navigeer naar de categorie 'Mystery' en vertel me de titel van het eerste boek in die categorie.",
  startingUrl: "http://books.toscrape.com/",
  domains: ["books.toscrape.com"],
  expectedKeywords: ["Sharp Objects"],
  maxSteps: 10,
};

const HIJACK_URL = "https://example.com/";

interface RunOutcome {
  attempt: number;
  hijackFired: boolean;
  recovered: boolean;
  matchedExpected: boolean;
  status: string;
  summary: string;
  steps: number;
  durationMs: number;
  failReason?: string;
}

function parseArgs(): { repeats: number; headed: boolean } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    repeats: get("--repeats") ? parseInt(get("--repeats")!, 10) : 8,
    headed: args.includes("--headed"),
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Zelfde signalen en logica als scripts/benchmark.ts's isRateLimitError — bewust
// gedupliceerd i.p.v. geïmporteerd, benchmark.ts exporteert 'm niet en dit script moet
// onafhankelijk blijven draaien als benchmark.ts verandert.
const RATE_LIMIT_SIGNALS = ["gratis ai-modellen", "alle providers faalden", "rate limit", "429", "quota"];

function isRateLimitOutcome(o: RunOutcome): boolean {
  const text = (o.summary ?? o.failReason ?? "").toLowerCase();
  return RATE_LIMIT_SIGNALS.some((s) => text.includes(s));
}

async function runOnce(attempt: number, headless: boolean): Promise<RunOutcome> {
  const { buildPool } = await import("../packages/companion/src/engine/pool.js");
  const { LlmRouter } = await import("../packages/companion/src/engine/router.js");
  const { AgentLoop } = await import("../packages/companion/src/agent/loop.js");
  const { CacheStore } = await import("../packages/companion/src/memory/cache-store.js");
  const { RecoveryStore } = await import("../packages/companion/src/memory/recovery-store.js");
  const { PlaywrightHand } = await import("../packages/companion/src/playwright-hand.js");
  const { ScopeGuard } = await import("../packages/companion/src/gate/scope-guard.js");

  const assignment = {
    id: `${TASK.id}-hijack-${attempt}`,
    description: TASK.goal.slice(0, 80),
    goal: TASK.goal,
    targetDomains: TASK.domains,
    maxActions: TASK.maxSteps,
    signedBy: "robustness-nav-hijack",
    createdAt: Date.now(),
  };

  const log = (m: string): void => process.stdout.write(`  ${m}\n`);
  const hand = new PlaywrightHand({ headless, log });
  const startedAt = Date.now();
  let hijackFired = false;

  try {
    await hand.init();

    const guard = new ScopeGuard(hand, assignment, log);
    const pool = buildPool();
    const router = new LlmRouter(pool, { log: (m) => log(`[motor] ${m}`) });
    const cacheStore = new CacheStore(resolve(repoRoot, "data"));
    const recoveryStore = new RecoveryStore(resolve(repoRoot, "data"));

    const loop = new AgentLoop(
      { chat: (req) => router.chat(req) },
      guard,
      {
        log,
        maxSteps: TASK.maxSteps,
        autonomy: "auto",
        cacheStore,
        recoveryStore,
        isAborted: () => guard.violated,
        // Zonder deze hint-functie krijgt de lus NOOIT een herstelplan bij een stuck-signaal
        // (zoals de "onverwachte navigatie" die de kaping hieronder expres veroorzaakt) en geeft
        // hij meteen op — dat test dan alleen "heeft Yad geen herstelmechanisme", niet "werkt
        // Yad's herstelmechanisme". Zelfde functie als benchmark.ts's runTask gebruikt.
        onStuck: async (reason) => {
          log(`[stuck] ${reason.why} op ${reason.url} — LLM-herstelplan aanvragen`);
          const { generateRecoveryHint } = await import("../packages/companion/src/agent/recovery.js");
          const hint = await generateRecoveryHint({ chat: (req) => router.chat(req) }, reason);
          if (hint) log(`[stuck] herstelplan: ${hint.slice(0, 120)}`);
          return hint;
        },
        // De kaping zelf: bij de EERSTE afgeronde stap (echt bewijs dat de agent al
        // gehandeld heeft, niet een gok op verstreken tijd) navigeren we buiten de lus
        // om weg. `void` bewust: de lus mag niet wachten op deze navigatie, dat zou het
        // scenario juist NIET reproduceren (een gebruiker wacht ook niet op de agent
        // voor de pagina verandert).
        stepLogger: {
          append: (e) => {
            if (e.step === 1 && !hijackFired) {
              hijackFired = true;
              log(`[kaping] stap 1 afgerond op ${e.url} — forceer navigatie naar ${HIJACK_URL}`);
              void hand.forceNavigateForTest(HIJACK_URL).catch((err: Error) => {
                log(`[kaping] navigatie zelf mislukte (telt niet als agent-fout): ${err.message}`);
              });
            }
          },
        },
      },
    );

    const navResult = await guard.act({ kind: "navigate", url: TASK.startingUrl });
    if (!navResult.ok) {
      return {
        attempt,
        hijackFired,
        recovered: false,
        matchedExpected: false,
        status: "nav-failed",
        summary: "",
        steps: 0,
        durationMs: Date.now() - startedAt,
        failReason: navResult.detail,
      };
    }

    const result = await loop.run(TASK.goal, TASK.maxSteps);
    const durationMs = Date.now() - startedAt;
    const summary = result.summary ?? "";
    const status = guard.violated ? "scope-violation" : result.status;
    const matchedExpected = TASK.expectedKeywords.every((kw) =>
      summary.toLowerCase().includes(kw.toLowerCase()),
    );

    return {
      attempt,
      hijackFired,
      recovered: status === "klaar" && matchedExpected,
      matchedExpected,
      status,
      summary,
      steps: result.steps,
      durationMs,
    };
  } catch (e) {
    return {
      attempt,
      hijackFired,
      recovered: false,
      matchedExpected: false,
      status: "exception",
      summary: "",
      steps: 0,
      durationMs: Date.now() - startedAt,
      failReason: (e as Error).message,
    };
  } finally {
    await hand.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  loadEnv();
  const { repeats, headed } = parseArgs();

  console.log(`\n🧪 ROBUUSTHEIDSTEST — onverwachte paginawisseling, ${repeats} herhalingen`);
  console.log(`Taak: ${TASK.id} — ${TASK.goal}`);
  console.log(`Kaping naar: ${HIJACK_URL} (bij stap 1)`);
  console.log("─".repeat(60));

  const outcomes: RunOutcome[] = [];

  for (let i = 1; i <= repeats; i++) {
    console.log(`\n[${i}/${repeats}]`);
    let outcome = await runOnce(i, !headed);

    if (isRateLimitOutcome(outcome)) {
      console.log("  ⏳ Rate-limit geraakt — wacht 120s voor retry (telt niet als een echte poging)...");
      await sleep(120_000);
      console.log(`  🔄 Retry: poging ${i}`);
      outcome = await runOnce(i, !headed);
    }

    outcomes.push(outcome);

    const icon = outcome.recovered ? "✅" : "❌";
    console.log(
      `${icon} kaping-gevuurd=${outcome.hijackFired} status=${outcome.status} ` +
        `hersteld=${outcome.recovered} stappen=${outcome.steps} tijd=${(outcome.durationMs / 1000).toFixed(1)}s`,
    );
    if (outcome.summary) console.log(`  Samenvatting: ${outcome.summary.slice(0, 120)}`);
    if (outcome.failReason) console.log(`  Faalreden: ${outcome.failReason}`);

    if (i < repeats) {
      console.log("  ⏸ Wacht 20s (quota cooldown)...");
      await sleep(20_000);
    }
  }

  const withHijack = outcomes.filter((o) => o.hijackFired);
  const recovered = withHijack.filter((o) => o.recovered);
  const noHijack = outcomes.filter((o) => !o.hijackFired);

  console.log(`\n${"─".repeat(60)}`);
  console.log("RESULTAAT");
  console.log("─".repeat(60));
  console.log(`Kaping daadwerkelijk gevuurd: ${withHijack.length}/${outcomes.length}`);
  console.log(
    `Herstelpercentage (van de gekaapte runs): ${recovered.length}/${withHijack.length} ` +
      `(${withHijack.length ? ((recovered.length / withHijack.length) * 100).toFixed(1) : "0.0"}%)`,
  );
  if (noHijack.length > 0) {
    console.log(
      `Let op: bij ${noHijack.length} run(s) vuurde de kaping niet af (agent haalde nooit stap 1 af) — ` +
        `niet meegeteld in het herstelpercentage, wel apart vermeld zodat dit niet stil verdwijnt.`,
    );
  }

  const dataDir = resolve(repoRoot, "data");
  mkdirSync(dataDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = resolve(dataDir, `robustness-nav-hijack-${ts}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        task: TASK,
        hijackUrl: HIJACK_URL,
        repeats,
        hijackFiredCount: withHijack.length,
        recoveredCount: recovered.length,
        recoveryRate: withHijack.length ? recovered.length / withHijack.length : 0,
        outcomes,
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.log(`\nRapport opgeslagen: ${reportPath}`);
}

main().catch((e: Error) => {
  console.error("[robustness-nav-hijack] Onverwachte fout:", e.message);
  process.exit(1);
});
