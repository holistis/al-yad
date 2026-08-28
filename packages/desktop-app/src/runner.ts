/**
 * runner — voert één run uit met de bestaande, bewezen motor: PlaywrightHand +
 * ScopeGuard + AgentLoop + LlmRouter + buildPool (packages/companion). Bijna
 * 1-op-1 de opzet van main-server.ts's POST /goal-handler. Twee verschillen:
 *
 *   1. Headed i.p.v. headless (default) — dit is een bureaublad-app, de
 *      gebruiker mag letterlijk toekijken hoe de browser werkt. Escape-hatch
 *      YAD_DESKTOP_HEADLESS=1 voor wie toch headless wil.
 *   2. Voortgang gaat naar RunState (via LiveHand) i.p.v. direct een
 *      HTTP-antwoord — main.ts's GET /run/status pollt die state.
 *
 * Dit Playwright-venster is een COMPLEET ANDER browserproces dan de Chrome
 * die de UI-schil toont (zie launch.ts) — de twee staan volledig los.
 */
import process from "node:process";
import { loadEnvFile } from "@yad/companion/dist/env.js";
import { buildPool } from "@yad/companion/dist/engine/pool.js";
import { LlmRouter } from "@yad/companion/dist/engine/router.js";
import { AgentLoop } from "@yad/companion/dist/agent/loop.js";
import { CacheStore } from "@yad/companion/dist/memory/cache-store.js";
import { PlaywrightHand } from "@yad/companion/dist/playwright-hand.js";
import { ScopeGuard } from "@yad/companion/dist/gate/scope-guard.js";
import { validateAssignment, type Assignment } from "@yad/companion/dist/gate/assignment.js";
import { LiveHand } from "./live-hand.js";
import type { RunState } from "./run-state.js";

const log = (m: string): void => console.log(`[desktop-app] ${m}`);

function headlessFromEnv(): boolean {
  const v = (process.env["YAD_DESKTOP_HEADLESS"] ?? "").toLowerCase();
  return v === "1" || v === "true";
}

// Eén gedeelde LLM-pool, gebouwd bij het laden van deze module — exact zoals
// main-server.ts dat bij de eigen module-start doet (regel ~49), NIET per
// run. Twee redenen, niet alleen efficiëntie: buildPool() kan synchroon
// THROWEN (bv. YAD_LOKAAL staat aan maar OLLAMA_BASE_URL wijst niet naar
// localhost — zie engine/pool.ts). Als dat per-run binnen runGoal() zou
// gebeuren, gebeurt het vóór de try/catch hieronder kan draaien, en omdat
// main.ts runGoal() als "void runGoal(...)" (fire-and-forget) aanroept, zou
// zo'n throw een unhandled rejection worden ÉN state.markError() nooit
// bereiken — de UI zou voor altijd op "running" blijven hangen. Hier, op
// module-niveau, gebeurt zo'n throw bij het opstarten van de server (net als
// bij main-server.ts): luid, zichtbaar in de console, en vóórdat er ooit een
// run kan starten.
//
// loadEnvFile() hier NOGMAALS aanroepen (main.ts doet dit ook) is bewust en
// veilig: ES-modules evalueren geïmporteerde modules VÓÓR de eigen
// top-level-code van de importeur, dus main.ts's loadEnvFile()-aanroep zou
// pas NA deze module-body lopen — te laat voor buildPool() hieronder.
// env.ts's loadEnvFile() is idempotent (overschrijft nooit een al-gezette
// env-waarde), dus twee keer aanroepen is een no-op, geen dubbele state.
loadEnvFile();
const pool = buildPool();
const router = new LlmRouter(pool, { log: (m) => log(`[llm] ${m}`) });
log(`LLM-pool: ${pool.map((p) => p.name).join(", ")} (${pool.length} providers)`);

export interface RunInput {
  goal: string;
  url?: string;
  /** Niet-leeg — main.ts leidt dit al af uit url als de aanroeper zelf niks opgaf. */
  domains: string[];
  maxSteps: number;
}

// Playwright's eigen chrome.launch() faalt met een lange, CLI-gerichte
// foutmelding ("...Please run the following command to download new
// browsers: npx playwright install...") als de ms-playwright-map ontbreekt
// (zie chrome-path.ts's docblock: dit is een dev-machine-only download,
// niet iets een geïnstalleerde build ooit zelf haalt). Zonder herschrijving
// zou de allereerste "Run" op een verse checkout die rauwe, ontwikkelaars-
// tekst tonen in een product dat zichzelf juist verkoopt als "geen
// CLI-commando's nodig" — dat is precies wat page.ts's foutpaneel verbatim
// doorzet. Hier één keer herkennen en vertalen naar een bruikbare, YAD-eigen
// instructie (die overigens ZELF wél een eenmalige build-tijd CLI-stap
// noemt — dat is eerlijk, niet in tegenspraak met de pitch: de pitch gaat
// over het GEBRUIKEN van de al-gebouwde app zonder CLI, niet over het
// bouwen ervan, wat toch al pnpm vereist).
function friendlyErrorMessage(e: Error): string {
  const msg = e.message ?? "";
  if (msg.includes("playwright install") || msg.includes("Executable doesn't exist")) {
    return (
      "De automatiseringsbrowser is nog niet gedownload op dit toestel. " +
      "Draai eenmalig 'npx playwright install chromium' (zie README.md) en probeer opnieuw."
    );
  }
  return msg;
}

/**
 * Voert de run uit en schrijft ALTIJD een eindstatus naar `state` (done of
 * error), zelfs bij een onverwachte throw — main.ts's GET /run/status mag
 * nooit voor altijd op "running" blijven staan door een vergeten catch-pad.
 *
 * De hele functie-body zit in de try/catch (niet pas vanaf hand-init) —
 * main.ts roept dit fire-and-forget aan ("void runGoal(...)"), dus een throw
 * vóór deze try (bv. uit assignment-constructie of validateAssignment()) zou
 * een unhandled rejection worden met niets dat state.markError() bereikt.
 * Vandaag is dat pad niet aantoonbaar bereikbaar (validateAssignment() is
 * puur defensief en de assignment-velden komen van triviale, veilige calls),
 * maar de bescherming kost hier niets en sluit die klasse van proces-crash
 * structureel uit i.p.v. op "blijft toevallig ongebruikt" te vertrouwen.
 */
export async function runGoal(input: RunInput, state: RunState): Promise<void> {
  let hand: PlaywrightHand | undefined;
  try {
    const assignment: Assignment = {
      id: `desktop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      description: input.goal.slice(0, 80),
      goal: input.goal,
      targetDomains: input.domains,
      maxActions: Math.min(input.maxSteps, 100),
      signedBy: "king",
      createdAt: Date.now(),
    };

    // Extra veiligheidslaag bovenop main.ts's eigen validatie (main-server.ts
    // zelf roept validateAssignment() niet aan, main-playwright.ts's CLI wel —
    // hier wél, want dit is de enige poort tussen "gebruiker klikt Run" en een
    // echte browser-actie: goedkoper om hier hard te weigeren dan verderop een
    // ScopeGuard-violation te laten afhandelen).
    const validation = validateAssignment(assignment);
    if (!validation.ok) {
      state.markError(`Toewijzing geweigerd: ${validation.errors.join("; ")}`);
      return;
    }

    hand = new PlaywrightHand({ headless: headlessFromEnv(), log: (m) => log(`[hand] ${m}`) });
    await hand.init();
    const guard = new ScopeGuard(hand, assignment, (m) => log(`[guard] ${m}`));
    const liveHand = new LiveHand(guard, state);
    const cache = new CacheStore();

    const loop = new AgentLoop(
      { chat: (req) => router.chat(req) },
      liveHand,
      {
        log: (m) => log(`[loop] ${m}`),
        maxSteps: assignment.maxActions,
        autonomy: "auto",
        cacheStore: cache,
        // guard.violated = een ScopeGuard-overtreding (bv. deny-listed pad).
        // state.abortRequested = main.ts's idle-wachter zag de UI stoppen met
        // pollen tijdens deze run (venster lijkt gesloten) en vroeg netjes
        // stoppen — AgentLoop heeft dit pad al: bij isAborted()===true stopt
        // hij zelf met status "gestopt" en de log-boodschap "Run afgebroken
        // (bijvoorbeeld: tab gesloten)." (packages/companion/src/agent/loop.ts).
        // Vóór deze wijziging was dat pad hier nooit bereikbaar: een gesloten
        // UI-venster liet de browser onbeheerd doorlopen tot maxActions.
        isAborted: () => guard.violated || state.abortRequested,
        pacingMs: 500,
      },
    );

    if (input.url) {
      await hand.act({ kind: "navigate", url: input.url });
    }

    const result = await loop.run(input.goal);

    state.markDone({
      status: guard.violated ? "scope-violation" : result.status,
      steps: result.steps,
      summary: result.summary ?? null,
      // result.stuckSignalId is NOOIT gezet (loop.run()'s return-statements
      // vullen dat veld niet, alleen de type-declaratie bestaat) — de echte
      // waarde staat op de loop-instantie zelf via de lastStuckSignalId-
      // getter, exact zoals session.ts dat na loop.run() ook uitleest.
      stuckSignal: loop.lastStuckSignalId ?? null,
    });
  } catch (e) {
    log(`Fout tijdens run: ${(e as Error).message}`);
    state.markError(friendlyErrorMessage(e as Error));
  } finally {
    await hand?.close().catch(() => {});
  }
}
