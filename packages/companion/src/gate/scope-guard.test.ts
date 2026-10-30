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

// ── Frame-scope (2026-09-15-audit): een ref kan uit een cross-origin iframe komen ──

class FrameAwareStubHand implements HandBridge {
  acts: Action[] = [];
  constructor(private readonly snap: Snapshot) {}
  async requestSnapshot(): Promise<Snapshot> { return this.snap; }
  async requestScreenshot(): Promise<string | null> { return null; }
  async act(a: Action): Promise<ActResult> { this.acts.push(a); return { ok: true }; }
  async requestConfirm(): Promise<boolean> { return true; }
  update(_u: { status: RunStatus; message: string }): void { /* noop */ }
}

describe("ScopeGuard — frame-scope op ref-acties (niet alleen navigate)", () => {
  it("blokkeert een click op een ref uit een cross-origin iframe buiten de toewijzing", async () => {
    const snap: Snapshot = {
      url: "https://www.example.com/",
      title: "Example",
      nodes: [{ ref: "f1:e1", role: "button", name: "Verifieer je account", frameUrl: "https://evil-widget.nl/frame" }],
      textDigest: "",
    };
    const hand = new FrameAwareStubHand(snap);
    const guard = new ScopeGuard(hand, ASSIGNMENT, () => {});
    await guard.requestSnapshot(); // bouwt de ref→frameUrl-cache
    const result = await guard.act({ kind: "click", ref: "f1:e1" });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("SCOPE_VIOLATION");
    expect(guard.violated).toBe(true);
    expect(hand.acts).toHaveLength(0);
  });

  it("laat een click op een ref uit een cross-origin iframe BINNEN de toewijzing gewoon door", async () => {
    const snap: Snapshot = {
      url: "https://www.example.com/",
      title: "Example",
      nodes: [{ ref: "f1:e1", role: "button", name: "Bevestig", frameUrl: "https://api.example.com/widget" }],
      textDigest: "",
    };
    const hand = new FrameAwareStubHand(snap);
    const guard = new ScopeGuard(hand, ASSIGNMENT, () => {});
    await guard.requestSnapshot();
    const result = await guard.act({ kind: "click", ref: "f1:e1" });
    expect(result.ok).toBe(true);
    expect(guard.violated).toBe(false);
    expect(hand.acts).toHaveLength(1);
  });

  it("laat een ref zonder bekende frameUrl gewoon door (niet-frame-bewuste Hand, bestaand gedrag)", async () => {
    const snap: Snapshot = {
      url: "https://www.example.com/",
      title: "Example",
      nodes: [{ ref: "e1", role: "button", name: "Gewone knop" }], // geen frameUrl
      textDigest: "",
    };
    const hand = new FrameAwareStubHand(snap);
    const guard = new ScopeGuard(hand, ASSIGNMENT, () => {});
    await guard.requestSnapshot();
    const result = await guard.act({ kind: "click", ref: "e1" });
    expect(result.ok).toBe(true);
    expect(guard.violated).toBe(false);
  });

  it("checkt ook toRef bij een drag-actie", async () => {
    const snap: Snapshot = {
      url: "https://www.example.com/",
      title: "Example",
      nodes: [
        { ref: "f0:e1", role: "button", name: "Bron", frameUrl: "https://www.example.com/" },
        { ref: "f1:e2", role: "button", name: "Doel", frameUrl: "https://evil-widget.nl/frame" },
      ],
      textDigest: "",
    };
    const hand = new FrameAwareStubHand(snap);
    const guard = new ScopeGuard(hand, ASSIGNMENT, () => {});
    await guard.requestSnapshot();
    const result = await guard.act({ kind: "drag", ref: "f0:e1", toRef: "f1:e2" });
    expect(result.ok).toBe(false);
    expect(guard.violated).toBe(true);
  });

  it("blokkeert een actie op een ref uit een verboden pad binnen een iframe (bv. /checkout)", async () => {
    const snap: Snapshot = {
      url: "https://www.example.com/",
      title: "Example",
      nodes: [{ ref: "f1:e1", role: "button", name: "Betaal nu", frameUrl: "https://www.example.com/checkout" }],
      textDigest: "",
    };
    const hand = new FrameAwareStubHand(snap);
    const guard = new ScopeGuard(hand, ASSIGNMENT, () => {});
    await guard.requestSnapshot();
    const result = await guard.act({ kind: "click", ref: "f1:e1" });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("verboden pad");
  });

  it("herbouwt de cache bij elke nieuwe requestSnapshot() (geen stale refs van een vorige pagina)", async () => {
    const snap1: Snapshot = {
      url: "https://www.example.com/",
      title: "Example",
      nodes: [{ ref: "f1:e1", role: "button", name: "Wisselend element", frameUrl: "https://evil-widget.nl/frame" }],
      textDigest: "",
    };
    const hand = new FrameAwareStubHand(snap1);
    const guard = new ScopeGuard(hand, ASSIGNMENT, () => {});
    await guard.requestSnapshot();
    const blocked = await guard.act({ kind: "click", ref: "f1:e1" });
    expect(blocked.ok).toBe(false);

    // Zelfde ref-string, maar een nieuwe snapshot zonder frameUrl-informatie (bv. terug op
    // het hoofdframe) — de oude, geblokkeerde herkomst mag niet blijven hangen.
    const guard2 = new ScopeGuard(new FrameAwareStubHand({ url: "https://www.example.com/", title: "Example", nodes: [{ ref: "f1:e1", role: "button", name: "Ander element" }], textDigest: "" }), ASSIGNMENT, () => {});
    await guard2.requestSnapshot();
    const allowed = await guard2.act({ kind: "click", ref: "f1:e1" });
    expect(allowed.ok).toBe(true);
  });
});
