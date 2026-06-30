/**
 * Objectief bewijs per stap — schrijft naar een append-only JSONL-bestand.
 *
 * Elke regel = één uitgevoerde actie + wat er echt is waargenomen (URL, ok, tekst).
 * Dit zijn FEITEN, geen interpretatie. De Planner (Claude Code) leest dit bestand
 * om te beoordelen of de acties kloppen met wat verwacht was.
 *
 * Regel: geen evaluatie hier, geen mening. Enkel URL + actie + resultaat + timestamp.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface StepEvidence {
  run: string;
  step: number;
  url: string;
  action: unknown;
  ok: boolean;
  extracted?: string;
  detail?: string;
  ts: number;
}

export class StepLogger {
  constructor(private readonly path: string) {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch { /* map bestaat al of rechten-probleem: zwijg */ }
  }

  append(e: StepEvidence): void {
    try {
      appendFileSync(this.path, JSON.stringify(e) + "\n", "utf-8");
    } catch { /* schrijffout: nooit de run onderbreken */ }
  }
}
