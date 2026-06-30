import { describe, it, expect } from "vitest";
import { computeConsistency, type VerifyRunStep } from "./verifier.js";

function run(steps: Array<{ ok: boolean; extracted?: string }>): VerifyRunStep[] {
  return steps.map((s, i) => ({ step: i + 1, ok: s.ok, extracted: s.extracted }));
}

describe("computeConsistency", () => {
  it("geeft 1.0 bij volledig identieke runs", () => {
    const r = computeConsistency([
      run([{ ok: true, extracted: "15 targets" }, { ok: true, extracted: "scope gelezen" }]),
      run([{ ok: true, extracted: "15 targets" }, { ok: true, extracted: "scope gelezen" }]),
    ]);
    expect(r.consistency).toBe(1);
    expect(r.matchedEvidence).toBe(true);
    expect(r.divergenceStep).toBeUndefined();
  });

  it("detecteert afwijkende tekst en geeft lage consistency", () => {
    const r = computeConsistency([
      run([{ ok: true, extracted: "15 targets" }]),
      run([{ ok: true, extracted: "login vereist" }]),
    ]);
    expect(r.consistency).toBe(0);
    expect(r.matchedEvidence).toBe(false);
    expect(r.divergenceStep).toBe(1);
  });

  it("geeft eerste divergentie-stap bij partiële mismatch", () => {
    const r = computeConsistency([
      run([{ ok: true, extracted: "A" }, { ok: true, extracted: "B" }, { ok: true, extracted: "C" }]),
      run([{ ok: true, extracted: "A" }, { ok: true, extracted: "X" }, { ok: true, extracted: "C" }]),
    ]);
    expect(r.consistency).toBeCloseTo(2 / 3);
    expect(r.divergenceStep).toBe(2);
  });

  it("normaliseert witruimte — extra spaties tellen niet als verschil", () => {
    const r = computeConsistency([
      run([{ ok: true, extracted: "  foo   bar  " }]),
      run([{ ok: true, extracted: "foo bar" }]),
    ]);
    expect(r.consistency).toBe(1);
  });

  it("beschouwt ok-vlag-mismatch als divergentie, ook bij zelfde tekst", () => {
    const r = computeConsistency([
      run([{ ok: true, extracted: "data" }]),
      run([{ ok: false, extracted: "data" }]),
    ]);
    expect(r.consistency).toBe(0);
    expect(r.divergenceStep).toBe(1);
  });

  it("geeft 1.0 bij slechts één run (niets te vergelijken)", () => {
    const r = computeConsistency([run([{ ok: true, extracted: "iets" }])]);
    expect(r.consistency).toBe(1);
  });

  it("geeft 1.0 bij lege runs", () => {
    const r = computeConsistency([[], []]);
    expect(r.consistency).toBe(1);
  });
});
