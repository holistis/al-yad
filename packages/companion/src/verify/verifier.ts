/**
 * Verification replay — voert een subset van eerder gelogde stappen N keer opnieuw
 * uit en vergelijkt het bewijs (ok + geëxtraheerde tekst) across runs.
 *
 * Doel: niet "wat denk ik dat er is gebeurd", maar "ik zag dit drie keer hetzelfde".
 * Dat is het verschil tussen interpretatie en bewijs.
 *
 * Regels:
 * - Elke retry begint op de startpagina van de eerste stap (harde reset).
 * - Vergelijking = feiten: ok-vlag + genormaliseerde tekst. Geen semantische evaluatie.
 * - consistency = deel van de stappen dat in alle retries identiek uitkwam.
 * - divergenceStep = eerste stap waar minstens één retry afweek.
 */

import type { Action, ActResult } from "@yad/shared";
import type { StepEvidence } from "../history/step-log.js";

const INTER_ACTION_DELAY = 600; // ms — niet mensachtig, maar niet bot-agressief
const POST_NAVIGATE_WAIT = 1500; // ms — geef de pagina tijd om te laden

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Verwijder witruimte-variatie zodat "  foo  bar" === "foo bar". */
function normalizeText(s?: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export interface VerifierSession {
  navigateTo(url: string): Promise<boolean>;
  act(action: Action): Promise<ActResult>;
}

export interface VerifyRunStep {
  step: number;
  ok: boolean;
  extracted?: string;
  detail?: string;
}

export interface ConsistencyResult {
  consistency: number;
  matchedEvidence: boolean;
  divergenceStep?: number;
}

export interface VerifyResult {
  runId: string;
  stepStart: number;
  stepEnd: number;
  retries: number;
  consistency: number;
  matchedEvidence: boolean;
  divergenceStep?: number;
  runs: VerifyRunStep[][];
}

/**
 * Vergelijkt runs op feit-niveau: ok-vlag + tekst.
 * Exporteer voor unit-tests — bevat geen IO.
 */
export function computeConsistency(runs: VerifyRunStep[][]): ConsistencyResult {
  const firstRun = runs[0];
  if (runs.length < 2 || !firstRun || firstRun.length === 0) {
    return { consistency: 1, matchedEvidence: true };
  }
  const stepCount = firstRun.length;
  let matched = 0;
  let divergenceStep: number | undefined;

  for (let i = 0; i < stepCount; i++) {
    const evidences = runs.map((r) => r[i]).filter((e): e is VerifyRunStep => e !== undefined);
    const ref = evidences[0];
    if (!ref) continue;
    const allSame =
      evidences.every((e) => e.ok === ref.ok) &&
      evidences.every((e) => normalizeText(e.extracted) === normalizeText(ref.extracted));

    if (allSame) {
      matched++;
    } else if (divergenceStep === undefined) {
      divergenceStep = ref.step;
    }
  }

  const consistency = matched / stepCount;
  return { consistency, matchedEvidence: consistency === 1, divergenceStep };
}

async function runOnce(steps: StepEvidence[], session: VerifierSession): Promise<VerifyRunStep[]> {
  if (steps.length === 0) return [];
  // Harde reset: begin altijd op de URL van de eerste stap.
  await session.navigateTo(steps[0]!.url);
  await sleep(POST_NAVIGATE_WAIT);

  const results: VerifyRunStep[] = [];
  for (const step of steps) {
    await sleep(INTER_ACTION_DELAY);
    let result: ActResult;
    try {
      result = await session.act(step.action as Action);
    } catch (e) {
      result = { ok: false, detail: (e as Error).message };
    }
    results.push({
      step: step.step,
      ok: result.ok,
      extracted: result.extracted,
      detail: result.detail,
    });
  }
  return results;
}

export async function verifySteps(
  runId: string,
  steps: StepEvidence[],
  retries: number,
  session: VerifierSession,
): Promise<VerifyResult> {
  const stepStart = steps[0]?.step ?? 0;
  const stepEnd = steps[steps.length - 1]?.step ?? 0;
  const runs: VerifyRunStep[][] = [];

  for (let i = 0; i < retries; i++) {
    runs.push(await runOnce(steps, session));
  }

  const { consistency, matchedEvidence, divergenceStep } = computeConsistency(runs);

  return { runId, stepStart, stepEnd, retries, consistency, matchedEvidence, divergenceStep, runs };
}
