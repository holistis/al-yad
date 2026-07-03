import { describe, it, expect } from "vitest";
import { SubstateTracker, type Substate } from "./substate.js";
import type { Snapshot } from "@yad/shared";

const makeSnap = (url: string, textDigest = ""): Snapshot => ({
  url,
  title: "test",
  nodes: [],
  textDigest,
});

const URL_ACCOUNT: Substate = {
  label: "navigeer naar account-pagina",
  predicates: [{ type: "url-contains", value: "/account" }],
};

const URL_ORDERS: Substate = {
  label: "open bestellingen",
  predicates: [{ type: "url-contains", value: "/orders" }],
};

describe("SubstateTracker — lege lijst", () => {
  it("hasSubstates is false", () => {
    expect(new SubstateTracker([]).hasSubstates).toBe(false);
  });

  it("progress is null", () => {
    expect(new SubstateTracker([]).progress).toBeNull();
  });

  it("toHint geeft null terug", () => {
    expect(new SubstateTracker([]).toHint()).toBeNull();
  });

  it("tryAdvance geeft false (niets te doen)", () => {
    const snap = makeSnap("https://x.nl/account");
    expect(new SubstateTracker([]).tryAdvance(snap)).toBe(false);
  });
});

describe("SubstateTracker — één substate", () => {
  it("advance als predicaat matcht", () => {
    const tracker = new SubstateTracker([URL_ACCOUNT]);
    const advanced = tracker.tryAdvance(makeSnap("https://shop.nl/account/info"));
    expect(advanced).toBe(true);
    expect(tracker.isComplete).toBe(true);
  });

  it("geen advance als predicaat niet matcht", () => {
    const tracker = new SubstateTracker([URL_ACCOUNT]);
    const advanced = tracker.tryAdvance(makeSnap("https://shop.nl/home"));
    expect(advanced).toBe(false);
    expect(tracker.isComplete).toBe(false);
  });

  it("toHint geeft stap 1/1 terug vóór completion", () => {
    const tracker = new SubstateTracker([URL_ACCOUNT]);
    expect(tracker.toHint()).toBe("HUIDIGE STAP 1/1: navigeer naar account-pagina");
  });

  it("toHint geeft VOLTOOID na advance", () => {
    const tracker = new SubstateTracker([URL_ACCOUNT]);
    tracker.tryAdvance(makeSnap("https://shop.nl/account"));
    expect(tracker.toHint()).toContain("STAPPEN VOLTOOID");
    expect(tracker.toHint()).toContain("1");
  });

  it("extra tryAdvance na isComplete geeft false", () => {
    const tracker = new SubstateTracker([URL_ACCOUNT]);
    tracker.tryAdvance(makeSnap("https://shop.nl/account"));
    expect(tracker.isComplete).toBe(true);
    const extra = tracker.tryAdvance(makeSnap("https://shop.nl/account"));
    expect(extra).toBe(false);
  });
});

describe("SubstateTracker — meerdere substates", () => {
  it("advance stap-voor-stap in volgorde", () => {
    const tracker = new SubstateTracker([URL_ACCOUNT, URL_ORDERS]);

    expect(tracker.progress?.currentIndex).toBe(0);
    expect(tracker.progress?.totalCount).toBe(2);

    // Stap 2 URL matcht nog NIET voor stap 1 (stap 1 checkt /account)
    const wrongFirst = tracker.tryAdvance(makeSnap("https://shop.nl/orders"));
    expect(wrongFirst).toBe(false);
    expect(tracker.progress?.currentIndex).toBe(0);

    // Stap 1 URL matcht
    const step1 = tracker.tryAdvance(makeSnap("https://shop.nl/account"));
    expect(step1).toBe(true);
    expect(tracker.progress?.currentIndex).toBe(1);
    expect(tracker.progress?.currentLabel).toBe("open bestellingen");

    // Stap 2 URL matcht
    const step2 = tracker.tryAdvance(makeSnap("https://shop.nl/orders/123"));
    expect(step2).toBe(true);
    expect(tracker.isComplete).toBe(true);
  });

  it("toHint toont actuele stap", () => {
    const tracker = new SubstateTracker([URL_ACCOUNT, URL_ORDERS]);
    expect(tracker.toHint()).toBe("HUIDIGE STAP 1/2: navigeer naar account-pagina");
    tracker.tryAdvance(makeSnap("https://shop.nl/account"));
    expect(tracker.toHint()).toBe("HUIDIGE STAP 2/2: open bestellingen");
    tracker.tryAdvance(makeSnap("https://shop.nl/orders"));
    expect(tracker.toHint()).toContain("STAPPEN VOLTOOID");
  });
});

describe("SubstateTracker — lege predicatenlijst", () => {
  it("nooit advance als predicaten leeg zijn (geen aantoonbaar eindcriterium)", () => {
    const tracker = new SubstateTracker([{ label: "doe iets", predicates: [] }]);
    const advanced = tracker.tryAdvance(makeSnap("https://shop.nl/ergens"));
    expect(advanced).toBe(false);
    expect(tracker.isComplete).toBe(false);
  });
});

describe("SubstateTracker — progress-velden", () => {
  it("progress bevat alle verwachte velden", () => {
    const tracker = new SubstateTracker([URL_ACCOUNT, URL_ORDERS]);
    const p = tracker.progress;
    expect(p).not.toBeNull();
    expect(p?.currentIndex).toBe(0);
    expect(p?.totalCount).toBe(2);
    expect(p?.currentLabel).toBe("navigeer naar account-pagina");
    expect(p?.isComplete).toBe(false);
  });
});
