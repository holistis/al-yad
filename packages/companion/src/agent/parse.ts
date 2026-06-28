import { ACTION_KINDS, type Action } from "@yad/shared";

export type ParseResult = { ok: true; action: Action } | { ok: false; error: string };

/** Haalt het eerste JSON-object uit een LLM-antwoord (ook door ```json fences). */
function extractJson(raw: string): string | null {
  let s = raw.trim();
  s = s.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  if (s.startsWith("{") && s.endsWith("}")) return s;
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return s.slice(first, last + 1);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

/** Parset en valideert precies één Action uit een LLM-antwoord. */
export function parseAction(raw: string): ParseResult {
  const json = extractJson(raw);
  if (!json) return { ok: false, error: "geen JSON-object gevonden" };

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
    case "navigate":
      if (!isStr(obj["url"])) return { ok: false, error: "navigate mist url" };
      return { ok: true, action: { kind, url: obj["url"] } };
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
