/**
 * Recovery-store — goedkope leerder op (site-pattern, fail-category).
 *
 * Wanneer de agent vastloopt en Claude Code een herstelplan stuurt dat WERKT
 * (run eindigt "klaar"), schrijft session.ts dat plan naar deze store.
 * Bij de volgende vastloop op dezelfde site met dezelfde fail-category haalt
 * escalateOrStop() de hint op ZONDER Claude Code te bellen.
 *
 * Ontwerp:
 *  - Opslag: JSONL (append-only, leesbaar, geen externe deps).
 *  - Key: sitePattern|failureCategory (bv. "saucedemo.com|repeat").
 *  - Bij duplicate key: provenCount ophogen + hint vervangen (nieuwste wint).
 *  - Lees-index in geheugen voor O(1) get(); hergebouwd bij opstarten.
 *
 * Scope: goedkope leerder, GEEN meta-leerder. Werkt al na één bewezen voorbeeld.
 * Meta-patroon (cross-site, model) komt pas als taxonomie geconvergeerd is (≥20 runs/cel).
 */

import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface RecoveryEntry {
  sitePattern: string;
  failureCategory: string;
  hint: string;
  provenAt: number;
  provenCount: number;
  schemaVersion: 1;
}

function defaultDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../../../data");
}

export class RecoveryStore {
  private readonly filePath: string;
  /** In-memory index voor O(1) get(). Sleutel: "sitePattern|failureCategory". */
  private readonly index = new Map<string, RecoveryEntry>();

  constructor(dataDir?: string) {
    const dir = dataDir ?? defaultDataDir();
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, "recovery-store.jsonl");
    this.loadIndex();
  }

  private static key(sitePattern: string, failureCategory: string): string {
    return `${sitePattern}|${failureCategory}`;
  }

  private loadIndex(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const lines = readFileSync(this.filePath, "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as RecoveryEntry;
          const k = RecoveryStore.key(entry.sitePattern, entry.failureCategory);
          this.index.set(k, entry);
        } catch { /* corrupte regel overslaan */ }
      }
    } catch { /* bestand niet leesbaar: start leeg */ }
  }

  /** Geeft de bewezen hint voor (sitePattern, failureCategory), of null als onbekend. */
  get(sitePattern: string, failureCategory: string): string | null {
    return this.index.get(RecoveryStore.key(sitePattern, failureCategory))?.hint ?? null;
  }

  /**
   * Registreer een bewezen herstelplan. Verhoogt provenCount als de sleutel al bestaat.
   * Schrijft append-only naar JSONL (oude regels worden niet gewist — de index houdt de winnaar bij).
   */
  record(sitePattern: string, failureCategory: string, hint: string): void {
    const k = RecoveryStore.key(sitePattern, failureCategory);
    const existing = this.index.get(k);
    const entry: RecoveryEntry = {
      sitePattern,
      failureCategory,
      hint,
      provenAt: Date.now(),
      provenCount: (existing?.provenCount ?? 0) + 1,
      schemaVersion: 1,
    };
    this.index.set(k, entry);
    try {
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf-8");
    } catch { /* schrijf-fout: stil overslaan, run niet onderbreken */ }
  }

  /** Alle opgeslagen entries (voor diagnose en dashboards). */
  readAll(): RecoveryEntry[] {
    return Array.from(this.index.values());
  }
}
