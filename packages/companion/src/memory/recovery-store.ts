/**
 * Recovery-store — goedkope leerder op (site-pattern, fail-category).
 *
 * Drie lookup-lagen (meest specifiek → meest generiek):
 *   Tier-1  sitePattern|failureCategory   — exact match (saucedemo.com|repeat)
 *   Tier-2  *|failureCategory             — cross-domain, zelfde signaal-id
 *   Tier-3  **|failureClass               — cross-domain, zelfde signaal-klasse
 *
 * Promotie:
 *   Zodra ≥2 verschillende sites hetzelfde failureCategory (of -class) bewijzen,
 *   maakt record() automatisch de bredere tier-2/tier-3 entry aan. Zo hoeft de
 *   leerder geen handmatige configuratie en groeit abstractie organisch uit bewijs.
 *
 * Opslag: JSONL (append-only, leesbaar, geen externe deps).
 * sitePattern-waarden: normaal domein | "*" (tier-2) | "**" (tier-3).
 */

import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface RecoveryEntry {
  sitePattern: string;       // domein, "*" (tier-2), of "**" (tier-3)
  failureCategory: string;   // signaal-id  (tier-1/2) of klasse-naam (tier-3)
  failureClass?: string;     // signaal-klasse — aanwezig bij tier-1 en tier-2 entries
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
  /** In-memory index O(1) get(). Sleutel: "sitePattern|id". */
  private readonly index = new Map<string, RecoveryEntry>();
  /** Unieke echte sites per failureCategory — telt voor tier-2 promotie. */
  private readonly byCategoryCount = new Map<string, Set<string>>();
  /** Unieke echte sites per failureClass — telt voor tier-3 promotie. */
  private readonly byClassCount = new Map<string, Set<string>>();

  constructor(dataDir?: string) {
    const dir = dataDir ?? defaultDataDir();
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, "recovery-store.jsonl");
    this.loadIndex();
  }

  private static key(sitePattern: string, id: string): string {
    return `${sitePattern}|${id}`;
  }

  private loadIndex(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const lines = readFileSync(this.filePath, "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as RecoveryEntry;
          this.index.set(RecoveryStore.key(entry.sitePattern, entry.failureCategory), entry);
          // Hertel promotie-tellers voor echte sites (geen wildcards)
          if (entry.sitePattern !== "*" && entry.sitePattern !== "**") {
            this.addToCategoryCount(entry.failureCategory, entry.sitePattern);
            if (entry.failureClass) this.addToClassCount(entry.failureClass, entry.sitePattern);
          }
        } catch { /* corrupte regel overslaan */ }
      }
    } catch { /* bestand niet leesbaar: start leeg */ }
  }

  private addToCategoryCount(category: string, site: string): void {
    let s = this.byCategoryCount.get(category);
    if (!s) { s = new Set(); this.byCategoryCount.set(category, s); }
    s.add(site);
  }

  private addToClassCount(cls: string, site: string): void {
    let s = this.byClassCount.get(cls);
    if (!s) { s = new Set(); this.byClassCount.set(cls, s); }
    s.add(site);
  }

  /**
   * Drie-laags lookup (tier-1 → tier-2 → tier-3).
   * failureClass is nodig voor tier-3; als null dan valt lookup terug op tier-2.
   */
  get(sitePattern: string, failureCategory: string, failureClass?: string): string | null {
    // Tier-1: exact match
    const t1 = this.index.get(RecoveryStore.key(sitePattern, failureCategory))?.hint;
    if (t1 != null) return t1;
    // Tier-2: zelfde signaal, elk domein
    const t2 = this.index.get(RecoveryStore.key("*", failureCategory))?.hint;
    if (t2 != null) return t2;
    // Tier-3: zelfde klasse, elk domein
    if (failureClass) {
      return this.index.get(RecoveryStore.key("**", failureClass))?.hint ?? null;
    }
    return null;
  }

  /**
   * Registreer een bewezen herstelplan.
   * Promoveert automatisch naar tier-2/tier-3 zodra ≥2 sites dezelfde category/class bewijzen.
   */
  record(sitePattern: string, failureCategory: string, hint: string, failureClass?: string): void {
    // Tier-1 altijd schrijven
    this.upsert(sitePattern, failureCategory, hint, failureClass);

    if (sitePattern === "*" || sitePattern === "**") return; // wildcards tellen niet mee

    // Tier-2 promotie: ≥2 unieke sites voor dezelfde failureCategory
    this.addToCategoryCount(failureCategory, sitePattern);
    const catSize = this.byCategoryCount.get(failureCategory)?.size ?? 0;
    if (catSize >= 2) {
      this.upsert("*", failureCategory, hint, failureClass);
    }

    // Tier-3 promotie: ≥2 unieke sites voor dezelfde failureClass
    if (failureClass) {
      this.addToClassCount(failureClass, sitePattern);
      const clsSize = this.byClassCount.get(failureClass)?.size ?? 0;
      if (clsSize >= 2) {
        this.upsert("**", failureClass, hint);
      }
    }
  }

  private upsert(sitePattern: string, id: string, hint: string, failureClass?: string): void {
    const k = RecoveryStore.key(sitePattern, id);
    const existing = this.index.get(k);
    const entry: RecoveryEntry = {
      sitePattern,
      failureCategory: id,
      ...(failureClass ? { failureClass } : {}),
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
