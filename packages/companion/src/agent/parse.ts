import { ACTION_KINDS, type Action } from "@yad/shared";
import { parsePredicates, type Predicate } from "./predicate.js";

/** Eén stap in een micro-plan: actie + optionele verwachte uitkomst voor de Judge. */
export interface PlannedStep {
  action: Action;
  /** Wat er zichtbaar of veranderd moet zijn na deze stap. Afwezig → Judge wordt overgeslagen. */
  expected?: string;
  /**
   * DONE-predicaten: alleen aanwezig bij finish-stappen. Objectief checkbare beweringen
   * die WAAR moeten zijn voordat de loop "klaar" mag retourneren. Als de snapshot
   * mismatcht, weigert de loop de finish en vraagt het model de resterende stappen af te ronden.
   * Afwezig of leeg → geen check (backwards compat).
   */
  done?: Predicate[];
}

export interface MicroPlan {
  steps: PlannedStep[]; // 1–3 purposeful steps; nooit 0
  rationale: string;    // waarom deze stappen — voor de step-log
}

export type ParseMicroPlanResult =
  | { ok: true; plan: MicroPlan }
  | { ok: false; error: string };

export type ParseResult = { ok: true; action: Action } | { ok: false; error: string };

/** Scant vanaf een '{' het eerste syntactisch complete object (strings/escapes-bewust). */
function scanObject(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Haalt het eerste geldige JSON-object uit een LLM-antwoord (ook met prose of ```json fences). */
function extractJson(raw: string): string | null {
  const s = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "{") continue;
    const candidate = scanObject(s, i);
    if (candidate) {
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        /* geen geldig object hier; probeer de volgende '{' */
      }
    }
  }
  return null;
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function isHttpUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

/** Parset en valideert precies één Action uit een LLM-antwoord. */
export function parseAction(raw: string): ParseResult {
  const json = extractJson(raw);
  if (!json) return { ok: false, error: "geen geldig JSON-object gevonden" };

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "ongeldige JSON" };
  }

  const kind = obj["kind"];
  if (typeof kind !== "string" || !ACTION_KINDS.includes(kind as Action["kind"])) {
    return { ok: false, error: `onbekende of ontbrekende kind: ${String(kind)}` };
  }

  switch (kind) {
    case "navigate": {
      if (!isStr(obj["url"])) return { ok: false, error: "navigate mist url" };
      if (!isHttpUrl(obj["url"])) {
        return { ok: false, error: "navigate vereist een geldige http/https-URL" };
      }
      return { ok: true, action: { kind, url: obj["url"] } };
    }
    case "click":
      if (!isStr(obj["ref"])) return { ok: false, error: "click mist ref" };
      return { ok: true, action: { kind, ref: obj["ref"] } };
    case "type":
      if (!isStr(obj["ref"]) || !isStr(obj["text"]))
        return { ok: false, error: "type mist ref of text" };
      return {
        ok: true,
        action: { kind, ref: obj["ref"], text: obj["text"], submit: obj["submit"] === true },
      };
    case "paste":
      if (!isStr(obj["ref"]) || !isStr(obj["text"]))
        return { ok: false, error: "paste mist ref of text" };
      return {
        ok: true,
        action: { kind, ref: obj["ref"], text: obj["text"], submit: obj["submit"] === true },
      };
    case "hover":
      if (!isStr(obj["ref"])) return { ok: false, error: "hover mist ref" };
      return { ok: true, action: { kind, ref: obj["ref"] } };
    case "keyboard":
      if (!isStr(obj["key"])) return { ok: false, error: "keyboard mist key" };
      return {
        ok: true,
        action: { kind, key: obj["key"], ...(isStr(obj["ref"]) ? { ref: obj["ref"] } : {}) },
      };
    case "upload":
      if (!isStr(obj["ref"]) || !isStr(obj["filename"]) || !isStr(obj["content"]))
        return { ok: false, error: "upload mist ref, filename of content" };
      return {
        ok: true,
        action: {
          kind,
          ref: obj["ref"],
          filename: obj["filename"].slice(0, 255),
          content: obj["content"].slice(0, 5_000_000),
          ...(isStr(obj["mimeType"]) ? { mimeType: obj["mimeType"] } : {}),
        },
      };
    case "select":
      if (!isStr(obj["ref"]) || !isStr(obj["value"]))
        return { ok: false, error: "select mist ref of value" };
      return { ok: true, action: { kind, ref: obj["ref"], value: obj["value"] } };
    case "extract":
      if (!isStr(obj["what"])) return { ok: false, error: "extract mist what" };
      return {
        ok: true,
        action: { kind, what: obj["what"], ...(isStr(obj["ref"]) ? { ref: obj["ref"] } : {}) },
      };
    case "scroll": {
      const dir = obj["direction"];
      if (dir !== "down" && dir !== "up" && dir !== "left" && dir !== "right")
        return { ok: false, error: "scroll: direction moet down/up/left/right zijn" };
      const amount = obj["amount"];
      return {
        ok: true,
        action: {
          kind,
          direction: dir,
          ...(typeof amount === "number" && amount > 0 ? { amount: Math.min(Math.round(amount), 20) } : {}),
          ...(isStr(obj["ref"]) ? { ref: obj["ref"] } : {}),
        },
      };
    }
    case "wait": {
      const ms = obj["ms"];
      if (typeof ms !== "number" || !Number.isFinite(ms))
        return { ok: false, error: "wait mist ms" };
      return { ok: true, action: { kind, ms: Math.max(0, Math.min(ms, 30_000)) } };
    }
    case "finish":
      if (!isStr(obj["summary"])) return { ok: false, error: "finish mist summary" };
      return { ok: true, action: { kind, summary: obj["summary"] } };
    default:
      return { ok: false, error: `niet-afgehandelde kind: ${kind}` };
  }
}

/**
 * Parseert een micro-plan uit een LLM-antwoord.
 *
 * Verwacht formaat: { "steps": [action, ...], "rationale": "..." }
 * Backward compat: als het model één actie teruggeeft (oud formaat),
 * wordt dat automatisch ingepakt als plan van 1 stap.
 */
export function parseMicroPlan(raw: string): ParseMicroPlanResult {
  const json = extractJson(raw);
  if (!json) return { ok: false, error: "geen geldig JSON-object gevonden" };

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "ongeldige JSON" };
  }

  // Nieuw formaat: { steps: [...], rationale: "..." }
  if (Array.isArray(obj["steps"])) {
    const rawSteps = (obj["steps"] as unknown[]).slice(0, 3);
    const steps: PlannedStep[] = [];
    for (const s of rawSteps) {
      const stepObj = s as Record<string, unknown>;
      const expected =
        typeof stepObj["expected"] === "string" && stepObj["expected"].trim()
          ? stepObj["expected"].trim()
          : undefined;
      const r = parseAction(JSON.stringify(s));
      if (r.ok) {
        const done = r.action.kind === "finish" ? parsePredicates(stepObj["done"]) : undefined;
        steps.push({ action: r.action, expected, ...(done && done.length > 0 ? { done } : {}) });
      }
    }
    if (steps.length === 0) return { ok: false, error: "plan bevat 0 geldige stappen" };
    return {
      ok: true,
      plan: {
        steps,
        rationale: typeof obj["rationale"] === "string" ? obj["rationale"] : "",
      },
    };
  }

  // Backward compat: enkel action object → plan van 1 stap
  const single = parseAction(raw);
  if (single.ok) return { ok: true, plan: { steps: [{ action: single.action }], rationale: "" } };

  return { ok: false, error: `onherkenbaar formaat (${single.error})` };
}
