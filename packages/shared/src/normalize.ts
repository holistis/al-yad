/**
 * Centrale tekst-normalisatie voor beide Handen (extension + Playwright).
 *
 * Dezelfde pagina moet via beide Handen tot identieke Snapshot-tekst leiden,
 * zodat predicaten (predicate.ts) betrouwbaar werken ongeacht welke Hand de
 * snapshot levert. Twee invarianten bewaken dit:
 *
 *  1. SNAPSHOT_LIMITS — één set grenzen, overal hetzelfde getal.
 *  2. normalizeText() — één functie: invisible-strip + whitespace-collapse + trim.
 *
 * Bewust GEEN lowercase hier: dat is vergelijkingstijd-normalisatie (predicate.ts
 * doet dat in norm()). Snapshot-tekst bewaard de originele hoofdletters zodat
 * LLM-prompts leesbaar blijven.
 */

// Zero-width (200B-200D), word-joiner (2060), BOM (FEFF) en bidi-controls
// (202A-202E, 2066-2069): strippen voordat tekst de prompt raakt. Opgebouwd
// uit code-punten zodat er geen onzichtbare tekens in de broncode staan.
const INVISIBLE_CODES = [
  0x200b, 0x200c, 0x200d, 0x2060, 0xfeff,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2066, 0x2067, 0x2068, 0x2069,
];
const INVISIBLE_RE = new RegExp(
  "[" + INVISIBLE_CODES.map((c) => "\\u" + c.toString(16).padStart(4, "0")).join("") + "]",
  "g",
);

/** Grenzen die beide Handen identiek moeten respecteren. */
export const SNAPSHOT_LIMITS = {
  /**
   * Maximaal aantal interactieve nodes per snapshot.
   * Was 150 tot 2026-08-23: op een pagina met een lange, altijd-in-de-DOM-aanwezige
   * (niet-gevirtualiseerde) optielijst vroeg in de paginavolgorde — bijv. HackerOne's
   * "kies je asset"-dropdown met 100+ knoppen vóór het eigenlijke rapportformulier —
   * verslindt die lijst het hele budget en komen velden verderop (Title/Description/
   * Impact) nooit meer in de snapshot terecht. isVisible() filtert dit niet weg omdat
   * scroll-buiten-beeld-maar-technisch-zichtbaar elementen een geldige boundingRect
   * en computed style hebben. Verhoogd naar 500 als directe, laag-risico oplossing.
   * Nettere fix voor later: isVisible() ook laten controleren of een element binnen
   * de zichtbare scroll-viewport van zijn dichtstbijzijnde scrollbare voorouder valt,
   * niet alleen of het technisch renderbaar is — dat lost dit voor ELKE lange lijst
   * op (zoekresultaten, infinite scroll) in plaats van alleen het node-budget te
   * vergroten. Zie yad-react-input-en-tabfocus-gat-2026-08-23 (Claude-memory).
   */
  MAX_NODES: 500,
  /** Maximale naam/waarde-lengte per node in tekens. */
  NAME_LIMIT: 120,
  /** Maximale textDigest-lengte in tekens. */
  DIGEST_LIMIT: 3000,
} as const;

/**
 * Normaliseert tekst voor opslag in een Snapshot:
 *  - strip onzichtbare unicode (anti prompt-injectie / ruis)
 *  - vouw meerdere witruimte samen tot één spatie
 *  - trim voor- en achterkant
 *
 * Deterministisch en puur: zelfde input → altijd zelfde output.
 */
export function normalizeText(s: string): string {
  return s.replace(INVISIBLE_RE, "").replace(/\s+/g, " ").trim();
}
