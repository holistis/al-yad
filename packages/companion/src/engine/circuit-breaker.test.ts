import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("opent na het drempelaantal fouten en sluit weer na de cooldown", () => {
    let t = 1000;
    const cb = new CircuitBreaker({ threshold: 3, cooldownMs: 5000, now: () => t });

    cb.recordFailure("p");
    cb.recordFailure("p");
    expect(cb.isOpen("p")).toBe(false); // nog onder de drempel
    cb.recordFailure("p");
    expect(cb.isOpen("p")).toBe(true); // open na 3

    t += 4999;
    expect(cb.isOpen("p")).toBe(true); // nog binnen cooldown
    t += 2;
    expect(cb.isOpen("p")).toBe(false); // cooldown voorbij -> half-open
  });

  it("recordSuccess reset de teller en sluit de breaker", () => {
    let t = 0;
    const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
    cb.recordFailure("p");
    cb.recordFailure("p");
    expect(cb.isOpen("p")).toBe(true);
    t += 1001;
    cb.recordSuccess("p");
    expect(cb.isOpen("p")).toBe(false);
    expect(cb.healthScore("p")).toBeGreaterThan(0);
  });

  it("health daalt bij fouten en stijgt bij succes", () => {
    const cb = new CircuitBreaker({ threshold: 10 });
    expect(cb.healthScore("p")).toBe(100);
    cb.recordFailure("p");
    expect(cb.healthScore("p")).toBeLessThan(100);
    const low = cb.healthScore("p");
    cb.recordSuccess("p");
    expect(cb.healthScore("p")).toBeGreaterThan(low);
  });

  it("houdt providers gescheiden", () => {
    const cb = new CircuitBreaker({ threshold: 1, cooldownMs: 1000, now: () => 0 });
    cb.recordFailure("a");
    expect(cb.isOpen("a")).toBe(true);
    expect(cb.isOpen("b")).toBe(false);
  });
});
