import { ACTION_KINDS, type Action } from "@yad/shared";

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
