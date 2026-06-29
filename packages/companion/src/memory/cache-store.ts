import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import process from "node:process";
import type { Action } from "@yad/shared";

const CACHE_VERSION = 1;
export const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dagen

export interface CacheEntry {
  key: string;
  goalPreview: string;
  urlPattern: string;
  actions: Action[];
  savedAt: number;
  hitCount: number;
  lastHitAt: number;
  totalRuns: number;
}

interface CacheFile {
  version: number;
  entries: CacheEntry[];
}

export function hashGoal(goal: string): string {
  return createHash("sha256").update(goal.toLowerCase().trim()).digest("hex").slice(0, 16);
}

/** Strips numerieke segmenten en UUIDs uit het pad zodat /product/12345 en /product/99 dezelfde sleutel geven. */
export function urlToPattern(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname
      .split("/")
      .map((seg) =>
        /^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)
          ? "*"
          : seg,
      )
      .join("/");
    return `${u.hostname}${path}`;
  } catch {
    return url.slice(0, 80);
  }
}

export function makeCacheKey(goal: string, startingUrl: string): string {
  return `${hashGoal(goal)}|${urlToPattern(startingUrl)}`;
}

/**
 * Sla op en herlaad gecachte actie-reeksen. JSON-bestand op schijf.
 * Injecteerbare klok (now) maakt tests deterministisch.
 */
export class CacheStore {
  private readonly filePath: string;
  private readonly now: () => number;

  constructor(dataDir?: string, now: () => number = () => Date.now()) {
    const dir = dataDir ?? process.env["YAD_DATA_DIR"] ?? join(process.cwd(), "data");
    this.filePath = join(dir, "action-cache.json");
    this.now = now;
  }

  private read(): CacheFile {
    if (!existsSync(this.filePath)) return { version: CACHE_VERSION, entries: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as CacheFile;
      if (parsed.version !== CACHE_VERSION) return { version: CACHE_VERSION, entries: [] };
      return parsed;
    } catch {
      return { version: CACHE_VERSION, entries: [] };
    }
  }

  private write(file: CacheFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf-8");
  }

  get(key: string): CacheEntry | undefined {
    const file = this.read();
    const n = this.now();
    return file.entries.find((e) => e.key === key && n - e.savedAt <= TTL_MS);
  }

  /** Schrijf of overschrijf een entry. Caller levert savedAt (injecteerbaar in tests). */
  set(entry: Omit<CacheEntry, "hitCount" | "lastHitAt">): void {
    const file = this.read();
    const idx = file.entries.findIndex((e) => e.key === entry.key);
    const full: CacheEntry = { ...entry, hitCount: 0, lastHitAt: 0 };
    if (idx >= 0) {
      file.entries[idx] = full;
    } else {
      file.entries.push(full);
    }
    this.write(file);
  }

  /** Registreer een cache-hit (teller + tijdstip). */
  hit(key: string): void {
    const file = this.read();
    const entry = file.entries.find((e) => e.key === key);
    if (!entry) return;
    entry.hitCount++;
    entry.lastHitAt = this.now();
    this.write(file);
  }

  /** Verwijder verlopen entries; geeft het aantal verwijderde entries terug. */
  evictExpired(): number {
    const file = this.read();
    const n = this.now();
    const before = file.entries.length;
    file.entries = file.entries.filter((e) => n - e.savedAt <= TTL_MS);
    const removed = before - file.entries.length;
    if (removed > 0) this.write(file);
    return removed;
  }
}
