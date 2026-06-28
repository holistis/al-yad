import { describe, it, expect } from "vitest";
import { parseAction } from "./parse.js";

describe("parseAction", () => {
  it("leest een kaal JSON-object", () => {
    const r = parseAction('{"kind":"click","ref":"e3"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action).toEqual({ kind: "click", ref: "e3" });
  });

  it("leest JSON uit ```json fences", () => {
    const r = parseAction('```json\n{"kind":"finish","summary":"klaar"}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.kind).toBe("finish");
  });

  it("leest JSON met omringende tekst", () => {
    const r = parseAction('Sure, here is the action: {"kind":"navigate","url":"https://x.nl"} done');
    expect(r.ok).toBe(true);
    if (r.ok && r.action.kind === "navigate") expect(r.action.url).toBe("https://x.nl");
  });

  it("zet submit standaard op false en clamp't wait", () => {
    const t = parseAction('{"kind":"type","ref":"e1","text":"hoi"}');
    expect(t.ok && t.action.kind === "type" && t.action.submit).toBe(false);
    const w = parseAction('{"kind":"wait","ms":999999}');
    expect(w.ok && w.action.kind === "wait" && w.action.ms).toBe(30000);
  });

  it("faalt op onbekende kind en ontbrekende velden", () => {
    expect(parseAction('{"kind":"explode"}').ok).toBe(false);
    expect(parseAction('{"kind":"click"}').ok).toBe(false);
    expect(parseAction("geen json hier").ok).toBe(false);
  });
});
