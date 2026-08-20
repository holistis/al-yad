/**
 * Selector-store — onthoudt per site welke (role, name)-combinaties succesvol
 * werden gebruikt. Geeft de LLM bij een nieuwe run een startersgids zodat hij
 * de juiste elementen sneller herkent.
 *
 * Werking:
 *  - Na elke geslaagde click/type/select/paste: record(hostname, path, role, name, kind)
 *  - Vóór elke LLM-aanroep: getHints() → geeft alleen elementen terug die
 *    DAADWERKELIJK aanwezig zijn in de huidige snapshot (stale-filter ingebakken).
 *  - Opslag: data/selector-memory.json (JSON, per hostname, max 50 entries)
 *
 * Stale-detectie:
 *  getHints() valideert entries live aan de hand van de huidige snapshot.
 *  Een element dat niet meer in de snapshot staat wordt NIET als hint teruggegeven
 *  maar ook NIET meteen verwijderd (het kan op een andere pagina staan).
 *  Gebruik evict() als je zeker weet dat een element weg is (bijv. actie mislukket).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Snapshot } from "@yad/shared";

const SCHEMA_VERSION = 1;
const MAX_ENTRIES_PER_HOST = 50;

export interface SelectorEntry {
  role: string;
  nameSubstring: string;   // lowercase, max 40 tekens
  urlPathPattern: string;  // gesimplificeerd pad (bijv. "/login", "/addresses"), leeg = alle pagina's
  actionKind: string;      // "click", "type", "select", "paste"
  successCount: number;
  lastSeen: string;        // ISO datumstring
  schemaVersion: 1;
}

interface StoreFile {
  version: number;
  hosts: Record<string, SelectorEntry[]>;
}

function defaultDataDir(): string {
  // Standalone/bundel: een expliciete data-map wint (de launcher zet YAD_DATA_DIR).
  const explicit = process.env["YAD_DATA_DIR"];
  if (explicit && explicit.length > 0) return explicit;
  // Dev (repo): relatief aan deze module. import.meta.url is leeg in een CJS-bundel,
  // dus afschermen en terugvallen op cwd/data i.p.v. crashen.
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

/**
 * Reduceer URL-pad tot een herkenbaar patroon: /login/12345 → /login, /addresses/99/edit → /addresses
 * Numerieke segmenten en UUID's worden verwijderd zodat hetzelfde soort pagina's matchen.
 */
function simplifyPath(urlPath: string): string {
  if (!urlPath) return "";
  return urlPath
    .split("/")
    .slice(0, 4)
    .filter(
      (seg) =>
        seg &&
        !/^\d+$/.test(seg) &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg),
    )
    .join("/")
    .toLowerCase() || "/";
}

export class SelectorStore {
  private readonly filePath: string;

  constructor(dataDir?: string) {
    const dir = dataDir ?? defaultDataDir();
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, "selector-memory.json");
  }

  private read(): StoreFile {
    if (!existsSync(this.filePath)) return { version: SCHEMA_VERSION, hosts: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as StoreFile;
      return parsed.version === SCHEMA_VERSION ? parsed : { version: SCHEMA_VERSION, hosts: {} };
    } catch {
      return { version: SCHEMA_VERSION, hosts: {} };
    }
  }

  private write(store: StoreFile): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(store, null, 2), "utf-8");
    } catch { /* schrijffout — nooit een run onderbreken */ }
  }

  /**
   * Sla een succesvol gebruikt element op voor dit hostname + pad.
   * Bestaande entry: incrementeer successCount. Nieuwe entry: voeg toe.
   * Cap op MAX_ENTRIES_PER_HOST (oudste entries worden verwijderd).
   */
  record(hostname: string, urlPath: string, role: string, name: string, actionKind: string): void {
    if (!hostname || !role || !name) return;
    const nameSubstring = name.slice(0, 40).toLowerCase().trim();
    if (!nameSubstring) return;
    const urlPathPattern = simplifyPath(urlPath);
    const store = this.read();
    if (!store.hosts[hostname]) store.hosts[hostname] = [];
    const entries = store.hosts[hostname];

    const existing = entries.find(
      (e) =>
        e.role === role &&
        e.nameSubstring === nameSubstring &&
        e.urlPathPattern === urlPathPattern,
    );
    if (existing) {
      existing.successCount++;
      existing.lastSeen = new Date().toISOString().slice(0, 10);
    } else {
      entries.push({
        role,
        nameSubstring,
        urlPathPattern,
        actionKind,
        successCount: 1,
        lastSeen: new Date().toISOString().slice(0, 10),
        schemaVersion: 1,
      });
      if (entries.length > MAX_ENTRIES_PER_HOST) {
        entries.sort((a, b) => a.lastSeen.localeCompare(b.lastSeen));
        entries.splice(0, entries.length - MAX_ENTRIES_PER_HOST);
      }
    }
    this.write(store);
  }

  /**
   * Geeft bekende elementen voor dit hostname als context-hint string.
   * Filtert live op de huidige snapshot — alleen elementen die ECHT aanwezig zijn
   * worden als hint teruggegeven (ingebakken stale-filter, nul false positives).
   * Geeft null terug als er niets relevants is.
   */
  getHints(hostname: string, urlPath: string, snapshot: Snapshot): string | null {
    const store = this.read();
    const entries = store.hosts[hostname] ?? [];
    if (entries.length === 0) return null;

    const currentPath = simplifyPath(urlPath);

    // Pad-filter: alleen entries die bij dit pad (of alle pagina's) horen.
    const relevant = entries.filter(
      (e) => !e.urlPathPattern || e.urlPathPattern === "/" || currentPath.startsWith(e.urlPathPattern),
    );
    if (relevant.length === 0) return null;

    // Snapshot-validatie: alleen hints voor elementen die daadwerkelijk in de snapshot staan.
    const confirmed = relevant.filter((e) =>
      snapshot.nodes.some(
        (n) =>
          n.role === e.role &&
          !n.disabled &&
          n.name.toLowerCase().includes(e.nameSubstring),
      ),
    );
    if (confirmed.length === 0) return null;

    const lines = confirmed
      .slice(0, 8)
      .map((e) => `- ${e.role} "${e.nameSubstring}" (${e.actionKind})`);

    return `KNOWN ELEMENTS from previous runs on this site (use as hints):\n${lines.join("\n")}`;
  }

  /**
   * Verwijder een stale entry handmatig (bijv. als een actie meermaals faalt op
   * een element dat hier geregistreerd staat).
   */
  evict(hostname: string, role: string, name: string): void {
    const store = this.read();
    const entries = store.hosts[hostname];
    if (!entries) return;
    const ns = name.slice(0, 40).toLowerCase().trim();
    store.hosts[hostname] = entries.filter(
      (e) => !(e.role === role && e.nameSubstring === ns),
    );
    this.write(store);
  }

  /** Alle opgeslagen entries (voor diagnose). */
  readAll(): Record<string, SelectorEntry[]> {
    return this.read().hosts;
  }
}
