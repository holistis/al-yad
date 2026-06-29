import { describe, it, expect } from "vitest";
import { replayCache } from "./replay.js";
import type { CacheEntry } from "./cache-store.js";
import type { Action, ActResult } from "@yad/shared";

function makeEntry(actions: Action[]): CacheEntry {
  return {
    key: "k1",
    goalPreview: "test",
    urlPattern: "shop.nl",
    actions,
    savedAt: 1_000_000,
    hitCount: 0,
    lastHitAt: 0,
    totalRuns: 1,
  };
}

type ActLog = { action: Action; ok: boolean };

function okAct(log: ActLog[]): (a: Action) => Promise<ActResult> {
  return async (a) => { log.push({ action: a, ok: true }); return { ok: true }; };
}

function failAtIndex(failIdx: number, log: ActLog[]): (a: Action) => Promise<ActResult> {
  let i = 0;
  return async (a) => {
    const ok = i !== failIdx;
    log.push({ action: a, ok });
    i++;
    return { ok };
  };
}

const noUpdate = () => {};

// ── complete replay ───────────────────────────────────────────────────────────

describe("replayCache: succesvolle replay", () => {
  it("geeft status complete terug als alle stappen slagen", async () => {
    const actions: Action[] = [
      { kind: "navigate", url: "https://shop.nl/producten" },
      { kind: "click", ref: "e1" },
    ];
    const log: ActLog[] = [];
    const result = await replayCache(makeEntry(actions), okAct(log), noUpdate);
    expect(result.status).toBe("complete");
    expect(result.completedSteps).toHaveLength(2);
    expect(log).toHaveLength(2);
  });

  it("roept update aan voor elke stap met het 🔁-prefix", async () => {
    const actions: Action[] = [{ kind: "navigate", url: "https://shop.nl/" }];
    const updates: string[] = [];
    await replayCache(makeEntry(actions), okAct([]), (msg) => updates.push(msg), );
    expect(updates[0]).toMatch(/^🔁/);
  });

  it("geeft een lege completedSteps bij een lege actie-reeks", async () => {
    const result = await replayCache(makeEntry([]), okAct([]), noUpdate);
    expect(result.status).toBe("complete");
    expect(result.completedSteps).toHaveLength(0);
  });
});

// ── drift ─────────────────────────────────────────────────────────────────────

describe("replayCache: drift", () => {
  it("geeft drift terug als een stap mislukt", async () => {
    const actions: Action[] = [
      { kind: "navigate", url: "https://shop.nl/" },
      { kind: "click", ref: "e1" },
      { kind: "click", ref: "e2" },
    ];
    const log: ActLog[] = [];
    const result = await replayCache(makeEntry(actions), failAtIndex(1, log), noUpdate);
    expect(result.status).toBe("drift");
    expect(result.driftAt).toBe(1);
    expect(result.completedSteps).toHaveLength(1); // alleen stap 0 geslaagd
  });

  it("stopt meteen bij de eerste mislukte stap", async () => {
    const actions: Action[] = [
      { kind: "navigate", url: "https://shop.nl/" },
      { kind: "click", ref: "e1" },
      { kind: "click", ref: "e2" },
    ];
    const log: ActLog[] = [];
    await replayCache(makeEntry(actions), failAtIndex(0, log), noUpdate);
    // Alleen de eerste stap geprobeerd, de rest niet
    expect(log).toHaveLength(1);
  });
});

// ── guardrails in replay ──────────────────────────────────────────────────────

describe("replayCache: guardrails", () => {
  it("weigert navigate naar een betaalpagina", async () => {
    const actions: Action[] = [
      { kind: "navigate", url: "https://shop.nl/checkout" },
    ];
    const result = await replayCache(makeEntry(actions), okAct([]), noUpdate);
    expect(result.status).toBe("drift");
    expect(result.driftAt).toBe(0);
  });

  it("weigert navigate naar een niet-http-schema", async () => {
    const actions: Action[] = [
      { kind: "navigate", url: "javascript:alert(1)" },
    ];
    const result = await replayCache(makeEntry(actions), okAct([]), noUpdate);
    expect(result.status).toBe("drift");
  });

  it("laat een veilige navigate door", async () => {
    const actions: Action[] = [
      { kind: "navigate", url: "https://shop.nl/producten" },
    ];
    const result = await replayCache(makeEntry(actions), okAct([]), noUpdate);
    expect(result.status).toBe("complete");
  });
});
