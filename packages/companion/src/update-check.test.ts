import { describe, it, expect } from "vitest";
import { isNieuwer, checkUpdate } from "./update-check.js";

/**
 * Versievergelijking is drie regels rekenwerk, maar het bepaalt wel of een klant een
 * update ziet. Een fout hier is stil: hij krijgt hem gewoon nooit, of juist eeuwig.
 */
describe("isNieuwer", () => {
  it("herkent een hoger nummer", () => {
    expect(isNieuwer("1.0.1", "1.0.0")).toBe(true);
    expect(isNieuwer("1.1.0", "1.0.9")).toBe(true);
    expect(isNieuwer("2.0.0", "1.99.99")).toBe(true);
  });
  it("herkent gelijk en lager", () => {
    expect(isNieuwer("1.0.0", "1.0.0")).toBe(false);
    expect(isNieuwer("1.0.0", "1.0.1")).toBe(false);
  });
  it("gaat om met ongelijke lengtes", () => {
    // 1.1 hoort nieuwer te zijn dan 1.0.9, ook al heeft het minder delen.
    expect(isNieuwer("1.1", "1.0.9")).toBe(true);
    expect(isNieuwer("1.0", "1.0.0")).toBe(false);
  });
  it("valt niet om op rommel", () => {
    expect(isNieuwer("kapot", "1.0.0")).toBe(false);
    expect(isNieuwer("", "1.0.0")).toBe(false);
  });
});

describe("checkUpdate", () => {
  it("meldt geen update en geen crash als de bron onbereikbaar is", async () => {
    const r = await checkUpdate("1.0.0", "http://127.0.0.1:59998/nergens.json");
    expect(r.nieuwer).toBe(false);
    expect(r.huidig).toBe("1.0.0");
    expect(r.reden).toBeDefined();
  });
});
