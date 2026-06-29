/**
 * De Action-DSL: de enige dingen die het Brein de Hand kan laten doen. De LLM
 * geeft precies één van deze terug als JSON; de Hand voert het deterministisch uit.
 * Geen vrije code, geen eval (MV3-veilig).
 */
export type Action =
  | { kind: "navigate"; url: string }
  | { kind: "click"; ref: string; scrollPause?: number }
  | { kind: "type"; ref: string; text: string; submit?: boolean; typeDelay?: number }
  | { kind: "select"; ref: string; value: string }
  | { kind: "extract"; what: string; ref?: string }
  | { kind: "wait"; ms: number }
  | { kind: "finish"; summary: string };

export type ActionKind = Action["kind"];

export const ACTION_KINDS: readonly ActionKind[] = [
  "navigate",
  "click",
  "type",
  "select",
  "extract",
  "wait",
  "finish",
];

/** Resultaat van een uitgevoerde actie, terug van de Hand naar het Brein. */
export interface ActResult {
  ok: boolean;
  detail?: string;
  /** geextraheerde inhoud bij een extract-actie */
  extracted?: string;
}
