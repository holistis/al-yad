import { describe, it, expect } from "vitest";
import { ScopeGuard } from "./scope-guard.js";
import type { Assignment } from "./assignment.js";
import type { Action, ActResult, RunStatus, Snapshot } from "@yad/shared";
import type { HandBridge } from "../agent/loop.js";

const ASSIGNMENT: Assignment = {
  id: "test-scope",
  description: "Test scope guard",
  goal: "Test IDOR",
  targetDomains: ["www.example.com", "api.example.com"],
  maxActions: 5,
  signedBy: "king",
  createdAt: Date.now(),
};

const SNAP: Snapshot = { url: "https://www.example.com/", title: "Example", nodes: [], textDigest: "" };

class StubHand implements HandBridge {
  acts: Action[] = [];
  async requestSnapshot(): Promise<Snapshot> { return SNAP; }
  async requestScreenshot(): Promise<string | null> { return null; }
  async act(a: Action): Promise<ActResult> { this.acts.push(a); return { ok: true }; }
  async requestConfirm(): Promise<boolean> { return true; }
  update(_u: { status: RunStatus; message: string }): void { /* noop */ }
}

// ── ScopeGuard ────────────────────────────────────────────────────────────────

describe("ScopeGuard", () => {
  it("laat een navigate naar een toegestaan domein door", async () => {
    const hand = new StubHand();
    const guard = new ScopeGuard(hand, ASSIGNMENT, () => {});
    const result = await guard.act({ kind: "navigate", url: "https://www.example.com/account" });
    expect(result.ok).toBe(true);
    expect(guard.violated).toBe(false);
    expect(hand.acts).toHaveLength(1);
  });

  it("blokkeert een navigate naar een niet-toegestaan domein", async () => {
    const hand = new StubHand();
    const guard = new ScopeGuard(hand, ASSIGNMENT, () => {});
    const result = await guard.act({ kind: "navigate", url: "https://www.other-site.nl/producten" });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("SCOPE_VIOLATION");
    expect(guard.violated).toBe(true);
    expect(hand.acts).toHaveLength(0); // inner never called
  });

  it("blokkeert een navigate naar een verboden pad (/checkout)", async () => {
    const hand = new StubHand();
    const guard = new ScopeGuard(hand, ASSIGNMENT, () => {});
    const result = await guard.act({ kind: "navigate", url: "https://www.example.com/checkout" });
    expect(result.ok).toBe(false);
    expect(guard.violated).toBe(true);
  });

  it("laat click/type door zonder domein-check (die is voor navigate)", async () => {
    const hand = new StubHand();
    const guard = new ScopeGuard(hand, ASSIGNMENT, () => {});
    const result = await guard.act({ kind: "click", ref: "e1" });
    expect(result.ok).toBe(true);
    expect(guard.violated).toBe(false);
  });

  it("blokkeert bij actie-limiet overschrijding", async () => {
    const hand = new StubHand();
    const a = { ...ASSIGNMENT, maxActions: 2 };
    const guard = new ScopeGuard(hand, a, () => {});
    await guard.act({ kind: "click", ref: "e1" }); // 1
    await guard.act({ kind: "click", ref: "e2" }); // 2
    const result = await guard.act({ kind: "click", ref: "e3" }); // 3 → geblokkeerd
    expect(result.ok).toBe(false);
    expect(guard.violated).toBe(true);
    expect(guard.violationDetail).toContain("Actie-limiet");
  });

  it("logt de overtreding in violations[]", async () => {
    const hand = new StubHand();
    const guard = new ScopeGuard(hand, ASSIGNMENT, () => {});
    await guard.act({ kind: "navigate", url: "https://evil.nl/hack" });
    expect(guard.violations).toHaveLength(1);
    expect(guard.violations[0]?.url).toBe("https://evil.nl/hack");
  });

  it("delegeert requestSnapshot en requestConfirm naar de inner hand", async () => {
    const hand = new StubHand();
    const guard = new ScopeGuard(hand, ASSIGNMENT, () => {});
    const snap = await guard.requestSnapshot();
    expect(snap.url).toBe("https://www.example.com/");
    const conf = await guard.requestConfirm({ kind: "wait", ms: 0 }, "test");
    expect(conf).toBe(true);
  });
});
