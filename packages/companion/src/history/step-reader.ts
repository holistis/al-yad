/**
 * Leest StepEvidence-regels uit het JSONL-bestand voor een specifieke run en stap-bereik.
 * Wordt gebruikt door de verifier om te weten WELKE acties opnieuw uitgevoerd moeten worden.
 */

import { existsSync, readFileSync } from "node:fs";
import type { StepEvidence } from "./step-log.js";

export function readSteps(
  logPath: string,
  runId: string,
  stepStart: number,
  stepEnd: number,
): StepEvidence[] {
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as StepEvidence)
      .filter((e) => e.run === runId && e.step >= stepStart && e.step <= stepEnd)
      .sort((a, b) => a.step - b.step);
  } catch {
    return [];
  }
}
