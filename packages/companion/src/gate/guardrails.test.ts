import { describe, it, expect } from "vitest";
import { checkDenied, needsConfirm, pathIsDenied } from "./guardrails.js";
import type { Action } from "@yad/shared";

describe("Poort: deny-lijst", () => {
  it("weigert navigatie naar checkout/payment/order", () => {
    expect(pathIsDenied("https://shop.nl/checkout")).toBe(true);
    expect(pathIsDenied("https://shop.nl/cart/payment")).toBe(true);
    expect(pathIsDenied("https://shop.nl/order/123")).toBe(true);
    expect(pathIsDenied("https://shop.nl/producten")).toBe(false);
  });

  it("weigert een navigate-actie naar een verboden pad", () => {
    const a: Action = { kind: "navigate", url: "https://shop.nl/checkout" };
    expect(checkDenied(a, { currentUrl: "https://shop.nl/" }).denied).toBe(true);
  });

  it("weigert elke schrijf-actie op een betaal-/checkout-pagina", () => {
    const a: Action = { kind: "click", ref: "e1" };
    expect(checkDenied(a, { currentUrl: "https://shop.nl/checkout" }).denied).toBe(true);
  });

  it("weigert klikken op een 'plaats bestelling'-knop", () => {
    const a: Action = { kind: "click", ref: "e1" };
    const v = checkDenied(a, { currentUrl: "https://shop.nl/cart", targetName: "Plaats bestelling" });
    expect(v.denied).toBe(true);
  });

  it("laat een gewone navigatie en een gewone klik door", () => {
    expect(checkDenied({ kind: "navigate", url: "https://shop.nl/zoeken" }, { currentUrl: "https://shop.nl/" }).denied).toBe(false);
    expect(checkDenied({ kind: "click", ref: "e2" }, { currentUrl: "https://shop.nl/", targetName: "Volgende pagina" }).denied).toBe(false);
  });
});

describe("Poort: confirm-before-act", () => {
  it("leest (extract/wait/finish) vereisen geen bevestiging", () => {
    expect(needsConfirm({ kind: "extract", what: "prijs" }, { currentUrl: "https://x.nl/" })).toBe(false);
    expect(needsConfirm({ kind: "finish", summary: "klaar" }, { currentUrl: "https://x.nl/" })).toBe(false);
  });

  it("type met submit vereist bevestiging", () => {
    expect(needsConfirm({ kind: "type", ref: "e1", text: "x", submit: true }, { currentUrl: "https://x.nl/" })).toBe(true);
  });

  it("klik op een opslaan/verstuur-knop vereist bevestiging", () => {
    expect(needsConfirm({ kind: "click", ref: "e1" }, { currentUrl: "https://x.nl/", targetName: "Opslaan" })).toBe(true);
    expect(needsConfirm({ kind: "click", ref: "e1" }, { currentUrl: "https://x.nl/", targetName: "Lees meer" })).toBe(false);
  });

  it("cross-origin navigatie vereist bevestiging, zelfde origin niet", () => {
    expect(needsConfirm({ kind: "navigate", url: "https://ander.nl/" }, { currentUrl: "https://x.nl/a" })).toBe(true);
    expect(needsConfirm({ kind: "navigate", url: "https://x.nl/b" }, { currentUrl: "https://x.nl/a" })).toBe(false);
  });

  it("eerste navigatie vanaf een lege/onbekende pagina hoeft geen bevestiging", () => {
    expect(needsConfirm({ kind: "navigate", url: "https://nu.nl/" }, { currentUrl: "about:blank" })).toBe(false);
    expect(needsConfirm({ kind: "navigate", url: "https://nu.nl/" }, { currentUrl: "" })).toBe(false);
    // maar een verboden doel blijft hard geweigerd door checkDenied (los van confirm):
    expect(checkDenied({ kind: "navigate", url: "https://shop.nl/checkout" }, { currentUrl: "about:blank" }).denied).toBe(true);
    expect(checkDenied({ kind: "navigate", url: "javascript:alert(1)" }, { currentUrl: "about:blank" }).denied).toBe(true);
  });

  it("select vereist altijd bevestiging", () => {
    expect(needsConfirm({ kind: "select", ref: "e1", value: "NL" }, { currentUrl: "https://x.nl/" })).toBe(true);
  });

  it("klik op een muterende ROL vereist bevestiging, ook zonder label", () => {
    expect(needsConfirm({ kind: "click", ref: "e1" }, { currentUrl: "https://x.nl/", role: "button" })).toBe(true);
    expect(needsConfirm({ kind: "click", ref: "e1" }, { currentUrl: "https://x.nl/", role: "checkbox" })).toBe(true);
    expect(needsConfirm({ kind: "click", ref: "e1" }, { currentUrl: "https://x.nl/", role: "link" })).toBe(false);
  });
});

describe("Poort: scheme-allowlist", () => {
  it("weigert javascript:/data:/file:/chrome: als navigatie-doel", () => {
    const base = { currentUrl: "https://shop.nl/" };
    expect(checkDenied({ kind: "navigate", url: "javascript:alert(1)" }, base).denied).toBe(true);
    expect(checkDenied({ kind: "navigate", url: "data:text/html,<b>x" }, base).denied).toBe(true);
    expect(checkDenied({ kind: "navigate", url: "file:///etc/passwd" }, base).denied).toBe(true);
    expect(checkDenied({ kind: "navigate", url: "chrome://settings" }, base).denied).toBe(true);
  });

  it("staat http/https toe", () => {
    expect(checkDenied({ kind: "navigate", url: "https://shop.nl/zoeken" }, { currentUrl: "https://shop.nl/" }).denied).toBe(false);
  });
});

describe("Poort: percent-encoding bypass", () => {
  it("weigert percent-geencodeerde checkout-paden", () => {
    expect(pathIsDenied("https://shop.nl/che%63kout")).toBe(true);
    expect(pathIsDenied("https://shop.nl/%2Fcheckout")).toBe(true);
    expect(pathIsDenied("https://shop.nl/CheckOut")).toBe(true);
  });

  it("weigert een navigate naar een geencodeerd checkout-pad", () => {
    expect(checkDenied({ kind: "navigate", url: "https://shop.nl/che%63kout" }, { currentUrl: "https://shop.nl/" }).denied).toBe(true);
  });

  it("weigert dubbel-geencodeerde checkout-paden", () => {
    expect(pathIsDenied("https://shop.nl/che%2563kout")).toBe(true);
  });
});

describe("Poort: SPA hash-route (rode lijn)", () => {
  it("weigert checkout/payment/order in het hash-fragment van een SPA", () => {
    expect(pathIsDenied("https://webshop.nl/#/checkout")).toBe(true);
    expect(pathIsDenied("https://webshop.nl/#/cart/payment")).toBe(true);
    expect(pathIsDenied("https://webshop.nl/#/order/123")).toBe(true);
    expect(pathIsDenied("https://webshop.nl/#/producten")).toBe(false);
  });

  it("weigert een navigate naar een hash-routed checkout", () => {
    expect(checkDenied({ kind: "navigate", url: "https://webshop.nl/#/checkout" }, { currentUrl: "https://webshop.nl/" }).denied).toBe(true);
  });

  it("stopt ook als de landingspagina-URL een hash-route checkout is", () => {
    // de loop hercontroleert pathIsDenied(snapshot.url); die moet de hash vangen
    expect(pathIsDenied("https://webshop.nl/#/checkout")).toBe(true);
  });
});

describe("Poort: muterende kassa-/bestel-link (rode lijn)", () => {
  it("weigert een klik op een 'Naar de kassa'- of 'Afrekenen'-link", () => {
    expect(checkDenied({ kind: "click", ref: "e1" }, { currentUrl: "https://shop.nl/cart", role: "link", targetName: "Naar de kassa" }).denied).toBe(true);
    expect(checkDenied({ kind: "click", ref: "e1" }, { currentUrl: "https://shop.nl/cart", role: "link", targetName: "Afrekenen" }).denied).toBe(true);
  });
});

describe("Poort: fail-safe bij onbekende URL", () => {
  it("weigert muterende acties bij een lege of niet-http pagina-URL", () => {
    expect(checkDenied({ kind: "click", ref: "e1" }, { currentUrl: "" }).denied).toBe(true);
    expect(checkDenied({ kind: "type", ref: "e1", text: "x" }, { currentUrl: "chrome://newtab" }).denied).toBe(true);
  });
});
