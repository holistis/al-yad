import { describe, it, expect } from "vitest";
import { validateAssignment, isUrlInAssignment, type Assignment } from "./assignment.js";

const VALID: Assignment = {
  id: "test-01",
  description: "Test IDOR op voorbeeldsite",
  goal: "Navigeer naar www.example.com en controleer IDOR",
  targetDomains: ["www.example.com", "api.example.com"],
  maxActions: 50,
  signedBy: "king",
  createdAt: Date.now(),
};

// ── validateAssignment ────────────────────────────────────────────────────────

describe("validateAssignment", () => {
  it("keurt een geldige assignment goed", () => {
    expect(validateAssignment(VALID).ok).toBe(true);
  });

  it("weigert als signedBy niet 'king' is", () => {
    const r = validateAssignment({ ...VALID, signedBy: "claude" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("king"))).toBe(true);
  });

  it("weigert een lege targetDomains", () => {
    const r = validateAssignment({ ...VALID, targetDomains: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("targetDomains"))).toBe(true);
  });

  it("weigert een wildcard-domein", () => {
    const r = validateAssignment({ ...VALID, targetDomains: ["*.example.com"] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("Wildcard"))).toBe(true);
  });

  it("weigert te veel domeinen (>5)", () => {
    const r = validateAssignment({
      ...VALID,
      targetDomains: ["a.nl", "b.nl", "c.nl", "d.nl", "e.nl", "f.nl"],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("maxim"))).toBe(true);
  });

  it("weigert maxActions > 200", () => {
    const r = validateAssignment({ ...VALID, maxActions: 999 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("maxActions"))).toBe(true);
  });

  it("weigert als goal leeg is", () => {
    const r = validateAssignment({ ...VALID, goal: "" });
    expect(r.ok).toBe(false);
  });

  it("weigert een niet-object", () => {
    const r = validateAssignment(null);
    expect(r.ok).toBe(false);
  });

  it("geeft meerdere fouten tegelijk terug", () => {
    const r = validateAssignment({ id: "", goal: "", targetDomains: [], maxActions: 0, signedBy: "robot", createdAt: 0 });
    expect(r.errors.length).toBeGreaterThan(2);
  });
});

// ── isUrlInAssignment ─────────────────────────────────────────────────────────

describe("isUrlInAssignment", () => {
  it("keurt een URL op een toegestaan domein goed", () => {
    expect(isUrlInAssignment("https://www.example.com/account", VALID)).toBe(true);
  });

  it("keurt een API-subdomein goed", () => {
    expect(isUrlInAssignment("https://api.example.com/v2/products", VALID)).toBe(true);
  });

  it("weigert een niet-toegestaan domein", () => {
    expect(isUrlInAssignment("https://www.other-domain.com/login", VALID)).toBe(false);
  });

  it("weigert een onveilig scheme (javascript:)", () => {
    expect(isUrlInAssignment("javascript:alert(1)", VALID)).toBe(false);
  });

  it("weigert een ongeldige URL", () => {
    expect(isUrlInAssignment("geen-url", VALID)).toBe(false);
  });

  it("negeert www. prefix bij vergelijking", () => {
    const a = { ...VALID, targetDomains: ["example.com"] };
    expect(isUrlInAssignment("https://www.example.com/shop", a)).toBe(true);
  });
});
