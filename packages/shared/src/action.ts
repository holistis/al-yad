/**
 * De Action-DSL: de enige dingen die het Brein de Hand kan laten doen. De LLM
 * geeft precies één van deze terug als JSON; de Hand voert het deterministisch uit.
 * Geen vrije code, geen eval (MV3-veilig).
 */
export type Action =
  | { kind: "navigate"; url: string }
  | { kind: "click"; ref: string; scrollPause?: number }
  | { kind: "click-at"; xFraction: number; yFraction: number }
  | { kind: "type"; ref: string; text: string; submit?: boolean; typeDelay?: number }
  | { kind: "paste"; ref: string; text: string; submit?: boolean }
  | { kind: "select"; ref: string; value: string }
  | { kind: "hover"; ref: string }
  | { kind: "keyboard"; key: string; ref?: string }
  | { kind: "upload"; ref: string; filename: string; content: string; mimeType?: string; base64?: boolean }
  | { kind: "upload-local"; ref: string; path: string; mimeType?: string }
  | { kind: "extract"; what: string; ref?: string }
  | { kind: "scroll"; direction: "down" | "up" | "left" | "right"; amount?: number; ref?: string }
  | { kind: "wait"; ms: number }
  /**
   * Wachten TOT iets waar is, in plaats van een vast aantal milliseconden.
   *
   * `wait` is gokken: te kort en je mist het, te lang en je verspilt de klant zijn tijd.
   * Een mens wacht niet drie seconden, hij wacht tot de knop er staat. Dit doet dat: de
   * lus haalt herhaaldelijk een snapshot op en toetst het predicaat, tot het klopt of de
   * tijd op is. De predicaat-taal is dezelfde die de agent al gebruikt voor
   * state-correctness, dus geen nieuw begrip om te leren.
   *
   * `predicate` is bewust los getypeerd: het echte type woont in de companion
   * (agent/predicate.ts) en shared mag daar niet van afhangen.
   */
  | { kind: "wait-for"; predicate: unknown; timeoutMs?: number; reason?: string }
  /** Slepen van het ene element naar het andere: lijsten sorteren, bestanden in een dropzone. */
  | { kind: "drag"; ref: string; toRef: string }
  /** Rechtermuisknop: contextmenu's van de pagina zelf (het menu van Chrome blijft buiten bereik). */
  | { kind: "right-click"; ref: string }
  /** Terug of vooruit in de geschiedenis, zoals de pijltjes in de browser. */
  | { kind: "history"; direction: "back" | "forward" }
  /** Tekst van een element naar het klembord, zodat een plak-actie erna werkt. */
  | { kind: "copy"; ref: string }
  | { kind: "finish"; summary: string };

export type ActionKind = Action["kind"];

export const ACTION_KINDS: readonly ActionKind[] = [
  "navigate",
  "click",
  "click-at",
  "type",
  "paste",
  "select",
  "hover",
  "keyboard",
  "upload",
  "upload-local",
  "extract",
  "scroll",
  "wait",
  "wait-for",
  "drag",
  "right-click",
  "history",
  "copy",
  "finish",
];

/** Resultaat van een uitgevoerde actie, terug van de Hand naar het Brein. */
export interface ActResult {
  ok: boolean;
  detail?: string;
  /** geextraheerde inhoud bij een extract-actie */
  extracted?: string;
}
