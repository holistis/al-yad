import { describe, it, expect } from "vitest";
import {
  makeSignal,
  rankFired,
  SIGNAL_SEVERITY,
  SIGNAL_CLASS,
  type Signal,
  type SignalId,
} from "./arbiter.js";

const ALL_IDS: SignalId[] = [
  "consecutive-act-failures",
  "state-loop",
  "url-regression",
  "silent-no-effect",
  "repeat",
  "no-progress",
  "goal-drift",
  "consecutive-unknowns",
];

describe("makeSignal", () => {
  it("leidt severity deterministisch af uit de id", () => {
    expect(makeSignal("repeat", "x").severity).toBe("hard");
    expect(makeSignal("no-progress", "x").severity).toBe("soft");
  });

  it("bewaart de evidence-string ongewijzigd", () => {
    const s = makeSignal("state-loop", "fingerprint gezien 5 stappen geleden");
    expect(s.evidence).toBe("fingerprint gezien 5 stappen geleden");
    expect(s.id).toBe("state-loop");
  });

  it("kent elk bekend signaal een severity toe (geen gaten in de map)", () => {
    for (const id of ALL_IDS) {
      expect(SIGNAL_SEVERITY[id]).toMatch(/^(hard|soft)$/);
    }
  });

  it("leidt class deterministisch af uit de id", () => {
    expect(makeSignal("repeat", "x").class).toBe("navigation-instability");
    expect(makeSignal("state-loop", "x").class).toBe("navigation-instability");
    expect(makeSignal("url-regression", "x").class).toBe("navigation-instability");
    expect(makeSignal("no-progress", "x").class).toBe("execution-stall");
    expect(makeSignal("consecutive-act-failures", "x").class).toBe("execution-stall");
    expect(makeSignal("silent-no-effect", "x").class).toBe("execution-stall");
    expect(makeSignal("goal-drift", "x").class).toBe("agent-confusion");
    expect(makeSignal("consecutive-unknowns", "x").class).toBe("agent-confusion");
  });

  it("kent elk bekend signaal een class toe (geen gaten in de map)", () => {
    for (const id of ALL_IDS) {
      expect(SIGNAL_CLASS[id]).toMatch(/^(navigation-instability|execution-stall|agent-confusion)$/);
    }
  });
});

describe("rankFired — lege invoer", () => {
  it("geeft primary null en lege fired-lijst (de kritieke 'geen signaal'-case)", () => {
    const r = rankFired([]);
    expect(r.primary).toBeNull();
    expect(r.fired).toEqual([]);
  });
});

describe("rankFired — enkel signaal", () => {
  it("geeft dat signaal als primary", () => {
    const s = makeSignal("goal-drift", "3 calls zonder voortgang");
    const r = rankFired([s]);
    expect(r.primary).toEqual(s);
    expect(r.fired).toHaveLength(1);
  });
});

describe("rankFired — hard subsumeert soft", () => {
  it("kiest het harde signaal als primary, ook als het soft signaal eerst binnenkomt", () => {
    const soft = makeSignal("no-progress", "6 calls");
    const hard = makeSignal("state-loop", "lus gedetecteerd");
    const r = rankFired([soft, hard]);
    expect(r.primary?.id).toBe("state-loop");
    expect(r.primary?.severity).toBe("hard");
  });

  it("bewaart ALLE vurende signalen (maskering blijft zichtbaar in de log)", () => {
    const soft = makeSignal("no-progress", "6 calls");
    const hard = makeSignal("state-loop", "lus");
    const r = rankFired([soft, hard]);
    expect(r.fired).toHaveLength(2);
    expect(r.fired.map((s) => s.id)).toContain("no-progress");
    expect(r.fired.map((s) => s.id)).toContain("state-loop");
  });

  it("property: als er een hard signaal in zit, is de primary nooit soft", () => {
    // Genereer alle niet-lege combinaties met minstens één hard signaal.
    const hardIds = ALL_IDS.filter((id) => SIGNAL_SEVERITY[id] === "hard");
    const softIds = ALL_IDS.filter((id) => SIGNAL_SEVERITY[id] === "soft");
    for (const h of hardIds) {
      for (const s of softIds) {
        const r1 = rankFired([makeSignal(s, "soft"), makeSignal(h, "hard")]);
        const r2 = rankFired([makeSignal(h, "hard"), makeSignal(s, "soft")]);
        expect(r1.primary?.severity).toBe("hard");
        expect(r2.primary?.severity).toBe("hard");
      }
    }
  });
});

describe("rankFired — prioriteit binnen dezelfde ernst", () => {
  it("consecutive-act-failures wint van andere harde signalen", () => {
    const r = rankFired([
      makeSignal("repeat", "x"),
      makeSignal("consecutive-act-failures", "y"),
      makeSignal("url-regression", "z"),
    ]);
    expect(r.primary?.id).toBe("consecutive-act-failures");
  });

  it("is deterministisch: dezelfde invoer in andere volgorde geeft dezelfde primary", () => {
    const a = makeSignal("url-regression", "x");
    const b = makeSignal("silent-no-effect", "y");
    expect(rankFired([a, b]).primary?.id).toBe(rankFired([b, a]).primary?.id);
  });

  it("sorteert soft-signalen onderling stabiel op prioriteit", () => {
    const r = rankFired([
      makeSignal("consecutive-unknowns", "x"),
      makeSignal("no-progress", "y"),
      makeSignal("goal-drift", "z"),
    ]);
    expect(r.fired.map((s) => s.id)).toEqual(["no-progress", "goal-drift", "consecutive-unknowns"]);
  });
});

describe("rankFired — muteert de invoer niet", () => {
  it("laat de originele array-volgorde intact", () => {
    const input: Signal[] = [
      makeSignal("no-progress", "x"),
      makeSignal("state-loop", "y"),
    ];
    const before = input.map((s) => s.id);
    rankFired(input);
    expect(input.map((s) => s.id)).toEqual(before);
  });
});
