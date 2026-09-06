import { describe, it, expect } from "vitest";
import { parseAction, parseMicroPlan } from "./parse.js";

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

  it("kiest het eerste GELDIGE object voorbij losse accolades", () => {
    const r = parseAction('Let op {dit is geen json} actie: {"kind":"finish","summary":"ok"}');
    expect(r.ok && r.action.kind === "finish").toBe(true);
  });

  it("pakt het eerste van twee objecten", () => {
    const r = parseAction('{"kind":"wait","ms":5}{"kind":"finish","summary":"x"}');
    expect(r.ok && r.action.kind === "wait").toBe(true);
  });

  it("weigert navigate met een niet-http scheme", () => {
    expect(parseAction('{"kind":"navigate","url":"javascript:alert(1)"}').ok).toBe(false);
    expect(parseAction('{"kind":"navigate","url":"file:///x"}').ok).toBe(false);
    expect(parseAction('{"kind":"navigate","url":"https://ok.nl"}').ok).toBe(true);
  });

  it("leest click-at met geldige fracties", () => {
    const r = parseAction('{"kind":"click-at","xFraction":0.42,"yFraction":0.67}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action).toEqual({ kind: "click-at", xFraction: 0.42, yFraction: 0.67 });
  });

  it("klemt click-at fracties naar 0-1", () => {
    const r = parseAction('{"kind":"click-at","xFraction":1.5,"yFraction":-0.3}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action).toEqual({ kind: "click-at", xFraction: 1, yFraction: 0 });
  });

  it("faalt op click-at zonder geldige xFraction/yFraction", () => {
    expect(parseAction('{"kind":"click-at"}').ok).toBe(false);
    expect(parseAction('{"kind":"click-at","xFraction":"0.5","yFraction":0.5}').ok).toBe(false);
  });
});

describe("parseMicroPlan", () => {
  it("carries the done array through for the legacy bare single-action finish format", () => {
    // Regression test for a real bug found while fixing the false-"klaar" gate:
    // Action itself has no "done" field (see @yad/shared), so the bare single-object
    // backward-compat branch used to build the PlannedStep from parseAction's return
    // alone and silently dropped any "done" array the model sent -- even though the
    // model did everything right. A model using this legacy format for finish could
    // therefore never supply DONE predicates at all.
    const r = parseMicroPlan('{"kind":"finish","summary":"done","done":[{"type":"url-contains","value":"sort=lohi"}]}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.steps).toHaveLength(1);
      expect(r.plan.steps[0]?.action).toEqual({ kind: "finish", summary: "done" });
      expect(r.plan.steps[0]?.done).toEqual([{ type: "url-contains", value: "sort=lohi" }]);
    }
  });

  it("still omits done for the legacy bare single-action format when none is supplied", () => {
    const r = parseMicroPlan('{"kind":"finish","summary":"done"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.steps[0]?.done).toBeUndefined();
  });

  it("does not attach done to non-finish actions in the legacy bare single-action format", () => {
    const r = parseMicroPlan('{"kind":"click","ref":"e1","done":[{"type":"url-contains","value":"x"}]}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.steps[0]?.done).toBeUndefined();
  });
});
