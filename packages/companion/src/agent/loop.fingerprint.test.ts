import { describe, it, expect } from "vitest";
import type { Snapshot } from "@yad/shared";
import { orderSensitiveFingerprint } from "./loop.js";

/**
 * Deze tests bewijzen de KERN van de effect-nul-detector: de volgorde-gevoelige
 * fingerprint moet identiek blijven als de pagina niet verandert (geen vals alarm),
 * en moet veranderen bij een echte doel-relevante mutatie (sorteertaak, formulier-
 * invoer, navigatie). Zonder dit onderscheid kan stil falen (Run 2) niet gevangen
 * worden en zou een correcte sorteertaak (Run 1) vals als "geen effect" gelden.
 */

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    url: "https://www.saucedemo.com/inventory.html",
    title: "Products",
    nodes: [
      { ref: "e1", role: "combobox", name: "sort" },
      { ref: "e2", role: "link", name: "Sauce Labs Backpack" },
      { ref: "e3", role: "link", name: "Sauce Labs Bike Light" },
      { ref: "e4", role: "button", name: "Add to cart" },
    ],
    textDigest: "Products Sauce Labs Backpack $29.99 Sauce Labs Bike Light $9.99",
    ...over,
  };
}

describe("orderSensitiveFingerprint", () => {
  it("is stabiel: dezelfde snapshot geeft dezelfde afdruk (geen vals effect-alarm)", () => {
    expect(orderSensitiveFingerprint(snap())).toBe(orderSensitiveFingerprint(snap()));
  });

  it("is puur: twee aanroepen op hetzelfde object zijn identiek", () => {
    const s = snap();
    expect(orderSensitiveFingerprint(s)).toBe(orderSensitiveFingerprint(s));
  });

  it("VERANDERT bij herordening van elementen (de sorteertaak — Run 1)", () => {
    const before = snap();
    // Sortering toegepast: productvolgorde omgedraaid in nodes én textDigest.
    const after = snap({
      nodes: [
        { ref: "e1", role: "combobox", name: "sort" },
        { ref: "e2", role: "link", name: "Sauce Labs Bike Light" },
        { ref: "e3", role: "link", name: "Sauce Labs Backpack" },
        { ref: "e4", role: "button", name: "Add to cart" },
      ],
      textDigest: "Products Sauce Labs Bike Light $9.99 Sauce Labs Backpack $29.99",
    });
    expect(orderSensitiveFingerprint(before)).not.toBe(orderSensitiveFingerprint(after));
  });

  it("VERANDERT bij URL-wijziging (navigatie is een effect)", () => {
    const before = snap();
    const after = snap({ url: "https://www.saucedemo.com/cart.html" });
    expect(orderSensitiveFingerprint(before)).not.toBe(orderSensitiveFingerprint(after));
  });

  it("VERANDERT als een veld gevuld raakt (formulier-invoer is een effect)", () => {
    const before = snap({
      nodes: [{ ref: "e1", role: "textbox", name: "First Name" }],
      textDigest: "Checkout",
    });
    const after = snap({
      nodes: [{ ref: "e1", role: "textbox", name: "First Name", value: "Test" }],
      textDigest: "Checkout",
    });
    expect(orderSensitiveFingerprint(before)).not.toBe(orderSensitiveFingerprint(after));
  });

  it("VERANDERT NIET bij een no-op klik op een statische pagina (Run 2: klik doet niets)", () => {
    // Simuleert de kern van Run 2: de agent klikt een element dat niets verandert.
    // Pre en post zijn identiek → de effect-nul-detector telt dit als verdachte no-op.
    const pre = snap();
    const postNoOp = snap(); // exact dezelfde pagina na de klik
    expect(orderSensitiveFingerprint(pre)).toBe(orderSensitiveFingerprint(postNoOp));
  });

  it("negeert refs: dezelfde pagina met verschoven ref-nummers blijft gelijk", () => {
    // Refs zijn positioneel en per-snapshot; ze mogen de effect-afdruk NIET beïnvloeden.
    const a = snap({
      nodes: [
        { ref: "e5", role: "combobox", name: "sort" },
        { ref: "e6", role: "link", name: "Sauce Labs Backpack" },
        { ref: "e7", role: "link", name: "Sauce Labs Bike Light" },
        { ref: "e8", role: "button", name: "Add to cart" },
      ],
    });
    expect(orderSensitiveFingerprint(snap())).toBe(orderSensitiveFingerprint(a));
  });
});
