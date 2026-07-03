/**
 * Deterministische, LLM-VRIJE predicaat-evaluator (Layer 2 — state correctness).
 *
 * Een predicaat is een objectief-checkbare bewering over een Snapshot: "de URL bevat
 * /checkout", "er is een knop met de naam Finish", "minstens één veld is gevuld".
 * De evaluator is een PURE functie: (predicate, Snapshot) → verdict. Twee keer
 * aanroepen op dezelfde snapshot geeft gegarandeerd hetzelfde resultaat.
 *
 * Ontwerpregels (uit de adversariele review, gegrond in de echte code):
 *  - GEEN ref-gebaseerde predicaten. Refs zijn positioneel en per-snapshot
 *    (perception.ts: `e${++i}`), dus een ref uit moment A wijst in snapshot B naar
 *    een ander element. Elk ref-predicaat zou de ref-drift-bug reproduceren.
 *  - Tekst-predicaten zijn ZWAK: textDigest is afgekapt (1500/3000 tekens, en 600 in
 *    de render). Ze mogen daarom NOOIT een harde "mismatch" geven op "niet gevonden"
 *    (dat kan afkap zijn) — alleen "match" (gevonden = betrouwbaar) of "indeterminate".
 *  - Normalisatie (lowercase + witruimte-collapse) zodat backend-verschillen tussen
 *    de twee Handen de uitkomst niet beïnvloeden. (Stap 3 centraliseert dit in @yad/shared.)
 */

import type { Snapshot, SnapshotNode } from "@yad/shared";

export type PredicateVerdict = "match" | "mismatch" | "indeterminate";

/** Rollen die als "invoerveld" tellen voor field-any-filled. */
const INPUT_ROLES = new Set(["textbox", "combobox", "checkbox", "searchbox", "spinbutton"]);

export type Predicate =
  | { type: "url-contains"; value: string }
  | { type: "role-present"; role: string; nameSubstring?: string }
  | { type: "role-absent"; role: string; nameSubstring?: string }
  | { type: "field-any-filled"; min?: number }
  | { type: "text-present"; value: string }
  | { type: "text-absent"; value: string }
  | { type: "attribute-equals"; role: string; nameSubstring?: string; attribute: "value" | "checked"; expected: string };

export const PREDICATE_TYPES: readonly Predicate["type"][] = [
  "url-contains",
  "role-present",
  "role-absent",
  "field-any-filled",
  "text-present",
  "text-absent",
  "attribute-equals",
];

/** Genormaliseerde vergelijking: witruimte-collapse + lowercase. */
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function nodeMatches(node: SnapshotNode, role: string, nameSubstring?: string): boolean {
  if (norm(node.role) !== norm(role)) return false;
  if (nameSubstring && !norm(node.name).includes(norm(nameSubstring))) return false;
  return true;
}

/**
 * Evalueert één predicaat tegen een snapshot. Puur, geen side-effects, geen LLM.
 */
export function evaluatePredicate(pred: Predicate, snapshot: Snapshot): PredicateVerdict {
  switch (pred.type) {
    case "url-contains": {
      const url = norm(snapshot.url);
      return url.includes(norm(pred.value)) ? "match" : "mismatch";
    }

    case "role-present": {
      const found = snapshot.nodes.some((n) => nodeMatches(n, pred.role, pred.nameSubstring));
      // Afwezigheid binnen de (afgekapte) node-set is niet 100% zeker, maar de set is
      // ruim (max 150) en dit is een best-effort deterministisch signaal.
      return found ? "match" : "mismatch";
    }

    case "role-absent": {
      const found = snapshot.nodes.some((n) => nodeMatches(n, pred.role, pred.nameSubstring));
      return found ? "mismatch" : "match";
    }

    case "field-any-filled": {
      const min = pred.min ?? 1;
      const filled = snapshot.nodes.filter(
        (n) => INPUT_ROLES.has(norm(n.role)) && n.value && n.value.trim() !== "",
      ).length;
      return filled >= min ? "match" : "mismatch";
    }

    case "text-present": {
      // ZWAK: gevonden = betrouwbaar (match); niet-gevonden kan afkap zijn (indeterminate).
      const digest = norm(snapshot.textDigest ?? "");
      return digest.includes(norm(pred.value)) ? "match" : "indeterminate";
    }

    case "text-absent": {
      // ZWAK: gevonden = betrouwbaar bewijs dat het er WÉL staat (mismatch);
      // niet-gevonden kan afkap zijn, dus we kunnen afwezigheid niet garanderen (indeterminate).
      const digest = norm(snapshot.textDigest ?? "");
      return digest.includes(norm(pred.value)) ? "mismatch" : "indeterminate";
    }

    case "attribute-equals": {
      // STERK: zoekt een node die role + nameSubstring matcht en vergelijkt het attribuut.
      // "value" is de geselecteerde/ingetypte waarde (bijv. combobox.value = "za").
      // "checked" is de checked-status (bijv. checkbox.value = "true"/"false").
      // Niet gevonden = mismatch (de combobox bestaat niet of heeft een andere waarde).
      const node = snapshot.nodes.find((n) => nodeMatches(n, pred.role, pred.nameSubstring));
      if (!node) return "mismatch";
      const actual = pred.attribute === "value" ? (node.value ?? "") : "";
      return norm(actual) === norm(pred.expected) ? "match" : "mismatch";
    }
  }
}

export interface PredicateSetVerdict {
  verdict: PredicateVerdict;
  matched: number;
  total: number;
}

/**
 * Evalueert een set predicaten (AND-semantiek):
 *  - "mismatch" als één predicaat hard mismatcht (deterministisch tegengesproken);
 *  - "match" als ALLE predicaten matchen;
 *  - anders "indeterminate" (minstens één onzeker, geen enkele harde mismatch).
 * Een lege set geeft "indeterminate" — nooit blind "match".
 */
export function evaluatePredicates(preds: Predicate[], snapshot: Snapshot): PredicateSetVerdict {
  if (preds.length === 0) return { verdict: "indeterminate", matched: 0, total: 0 };
  let matched = 0;
  let anyIndeterminate = false;
  for (const p of preds) {
    const v = evaluatePredicate(p, snapshot);
    if (v === "mismatch") return { verdict: "mismatch", matched, total: preds.length };
    if (v === "match") matched++;
    else anyIndeterminate = true;
  }
  const verdict: PredicateVerdict = anyIndeterminate ? "indeterminate" : "match";
  return { verdict, matched, total: preds.length };
}

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Valideert en parseert één predicaat uit LLM-output. Verwerpt onbekende types en
 * ELK predicaat dat naar een ref verwijst (ref-gebaseerde predicaten zijn verboden).
 * Retourneert null bij ongeldig — de aanroeper dropt het (zoals parseMicroPlan doet).
 */
export function parsePredicate(raw: unknown): Predicate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // Hard verbod: geen enkel predicaat mag een ref dragen (drift-onbestendig).
  if ("ref" in o) return null;
  const type = o["type"];
  if (typeof type !== "string" || !PREDICATE_TYPES.includes(type as Predicate["type"])) return null;

  switch (type) {
    case "url-contains":
      return isStr(o["value"]) ? { type, value: o["value"] } : null;
    case "role-present":
    case "role-absent":
      if (!isStr(o["role"])) return null;
      return {
        type,
        role: o["role"],
        ...(isStr(o["nameSubstring"]) ? { nameSubstring: o["nameSubstring"] } : {}),
      };
    case "field-any-filled": {
      const min = o["min"];
      return { type, ...(typeof min === "number" && min > 0 ? { min: Math.floor(min) } : {}) };
    }
    case "text-present":
    case "text-absent":
      return isStr(o["value"]) ? { type, value: o["value"] } : null;
    case "attribute-equals": {
      if (!isStr(o["role"])) return null;
      const attr = o["attribute"];
      if (attr !== "value" && attr !== "checked") return null;
      if (!isStr(o["expected"])) return null;
      return {
        type,
        role: o["role"],
        ...(isStr(o["nameSubstring"]) ? { nameSubstring: o["nameSubstring"] } : {}),
        attribute: attr,
        expected: o["expected"],
      };
    }
    default:
      return null;
  }
}

/** Parseert een array van predicaten; ongeldige exemplaren worden gedropt. */
export function parsePredicates(raw: unknown): Predicate[] {
  if (!Array.isArray(raw)) return [];
  const out: Predicate[] = [];
  for (const item of raw) {
    const p = parsePredicate(item);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Compacte grammatica-beschrijving voor in de LLM-prompt (Stap 4/5). Houdt de
 * generatie begrensd tot exact de checkbare, ref-vrije predicaat-types.
 */
export const PREDICATE_GRAMMAR = `Predicate types (ref-free, deterministically checkable against the page snapshot):
- {"type":"url-contains","value":"/checkout"}            → URL path/query contains the value (STRONG)
- {"type":"role-present","role":"button","nameSubstring":"Finish"}  → element with this role/name exists (STRONG)
- {"type":"role-absent","role":"button","nameSubstring":"Login"}    → no such element exists (STRONG)
- {"type":"attribute-equals","role":"combobox","nameSubstring":"Sort","attribute":"value","expected":"za"} → element attribute equals expected value (STRONG)
- {"type":"field-any-filled","min":1}                    → at least min input fields have a non-empty value (STRONG)
- {"type":"text-present","value":"Thank you"}            → visible page text contains the value (WEAK: truncated text = indeterminate)
- {"type":"text-absent","value":"Error"}                 → visible page text does not contain the value (WEAK)
NEVER reference element refs (e1, e2, ...) — refs are per-snapshot and drift. Prefer url-contains, role-present, attribute-equals.`;
