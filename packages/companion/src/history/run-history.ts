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
  // Standalone/bundel: een expliciete data-map wint (de launcher zet YAD_DATA_DIR).
  const explicit = process.env["YAD_DATA_DIR"];
  if (explicit && explicit.length > 0) return explicit;
  // Dev (repo): dist/history -> dist -> companion -> packages -> al-yad -> data/.
  // import.meta.url is leeg in een CJS-bundel, dus afschermen en terugvallen op cwd/data.
  try {
    const url = import.meta.url;
    if (url && url.length > 0) {
      const here = dirname(fileURLToPath(url));
      return join(here, "../../../../data");
    }
  } catch {
    /* bundel zonder module-url */
  }
  return join(process.cwd(), "data");
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
