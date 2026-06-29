import { describe, it, expect } from "vitest";
import { getSiteProfile } from "./site-profile.js";

describe("getSiteProfile", () => {
  it("herkent LinkedIn als stealth", () => {
    expect(getSiteProfile("https://www.linkedin.com/jobs/search/")).toMatchObject({ tier: "stealth" });
    expect(getSiteProfile("https://linkedin.com/in/example")).toMatchObject({ tier: "stealth" });
    expect(getSiteProfile("https://nl.linkedin.com/")).toMatchObject({ tier: "stealth" });
  });

  it("herkent andere anti-bot sites als stealth", () => {
    expect(getSiteProfile("https://www.facebook.com/")).toMatchObject({ tier: "stealth" });
    expect(getSiteProfile("https://instagram.com/explore/")).toMatchObject({ tier: "stealth" });
    expect(getSiteProfile("https://www.amazon.nl/s?k=test")).toMatchObject({ tier: "stealth" });
    expect(getSiteProfile("https://www.glassdoor.nl/jobs/")).toMatchObject({ tier: "stealth" });
  });

  it("herkent localhost als fast", () => {
    expect(getSiteProfile("http://localhost:3000/")).toMatchObject({ tier: "fast" });
    expect(getSiteProfile("http://127.0.0.1:8080/")).toMatchObject({ tier: "fast" });
  });

  it("herkent privé-netwerken als fast", () => {
    expect(getSiteProfile("http://192.168.1.1/admin")).toMatchObject({ tier: "fast" });
    expect(getSiteProfile("http://10.0.0.5/dashboard")).toMatchObject({ tier: "fast" });
  });

  it("geeft .local-domeinen fast", () => {
    expect(getSiteProfile("http://mijnapp.local/")).toMatchObject({ tier: "fast" });
  });

  it("geeft gewone sites normal", () => {
    expect(getSiteProfile("https://www.nu.nl/")).toMatchObject({ tier: "normal" });
    expect(getSiteProfile("https://www.bol.com/")).toMatchObject({ tier: "normal" });
    expect(getSiteProfile("https://REDACTED/")).toMatchObject({ tier: "normal" });
  });

  it("geeft about:blank normal", () => {
    expect(getSiteProfile("about:blank")).toMatchObject({ tier: "normal" });
    expect(getSiteProfile("")).toMatchObject({ tier: "normal" });
  });

  it("stealth-profiel heeft hogere pacingMs dan normal", () => {
    const stealth = getSiteProfile("https://linkedin.com/");
    const normal = getSiteProfile("https://nu.nl/");
    const fast = getSiteProfile("http://localhost/");
    expect(stealth.pacingMs).toBeGreaterThan(normal.pacingMs);
    expect(normal.pacingMs).toBeGreaterThan(fast.pacingMs);
  });

  it("stealth heeft typeDelayMs > 0, normal en fast hebben 0", () => {
    expect(getSiteProfile("https://linkedin.com/").typeDelayMs).toBeGreaterThan(0);
    expect(getSiteProfile("https://nu.nl/").typeDelayMs).toBe(0);
    expect(getSiteProfile("http://localhost/").typeDelayMs).toBe(0);
  });
});
