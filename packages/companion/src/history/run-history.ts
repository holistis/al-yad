/**
 * Run-history: slaat elke agent-run op als een JSONL-regel in data/run-history.jsonl.
 * Geen externe deps, geen database — append-only, lichtgewicht, leesbaar.
 */
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface RunHistoryEntry {
  id: string;
  goal: string;
  status: string;
  steps: number;
  summary?: string;
  startedAt: number;
  finishedAt: number;
  startingUrl?: string;
  cached?: boolean;
  // v2 — RunRecord-substraat (optioneel voor backward compat met oude entries)
  outcome?: "success" | "stuck" | "aborted" | "error";
  failureCategory?: string;
  hadRecovery?: boolean;
  schemaVersion?: 1;
}

function defaultDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/history -> dist -> companion -> packages -> al-yad -> data/
  return join(here, "../../../../data");
}

export class RunHistoryStore {
  private readonly filePath: string;

  constructor(dataDir?: string) {
    const dir = dataDir ?? defaultDataDir();
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, "run-history.jsonl");
  }

  append(entry: RunHistoryEntry): void {
    try {
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      /* schrijf-fout (bv. permissie) — stil overslaan, run niet onderbreken */
    }
  }

  readLast(n: number): RunHistoryEntry[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const lines = readFileSync(this.filePath, "utf-8")
        .split("\n")
        .filter(Boolean);
      return lines
        .slice(-n)
        .map((l) => JSON.parse(l) as RunHistoryEntry)
        .reverse();
    } catch {
      return [];
    }
  }
}
