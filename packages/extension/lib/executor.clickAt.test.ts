import { describe, it, expect, afterEach } from "vitest";
import { executeAction } from "./executor";

/**
 * Restpunt uit de adversariële review 2026-09-13: clickAtViewportPoint() had voorheen
 * alleen de smalle DENY_WORDS-check, geen equivalent van needsConfirm() voor write-rollen
 * in het algemeen — de companion-poort (guardrails.ts) kende het doelwit van een click-at
 * pas NA de klik. De fix voegt een `resolveOnly`-modus toe: de extensie zoekt het
 * doelwit op (elementFromPoint) en geeft rol + toegankelijke naam terug ZONDER te klikken,
 * zodat de companion-lus (loop.ts, buildGateContext) daarmee dezelfde write-role/
 * CONFIRM_WORDS/DENY_WORDS-poort kan draaien als bij een gewone klik, vóórdat een mens om
 * bevestiging wordt gevraagd of er geklikt wordt.
 *
 * Deze tests dekken de extensie-kant van die fix: resolveOnly identificeert correct
 * zonder te klikken, en de bestaande DENY_WORDS-check op het WERKELIJKE klikmoment
 * blijft intact als tweede laag (de pagina kan tussen resolve en menselijke bevestiging
 * veranderen).
 */

afterEach(() => {
  document.body.innerHTML = "";
});

describe("executeAction click-at — resolveOnly (geen klik, alleen doelwit identificeren)", () => {
  it("identificeert een muterend doelwit (button) zonder te klikken", async () => {
    document.body.innerHTML = `<button id="danger">Verwijder account</button>`;
    const btn = document.getElementById("danger") as HTMLButtonElement;
    let clicked = false;
    btn.addEventListener("click", () => (clicked = true));
    document.elementFromPoint = () => btn;

    const result = await executeAction(
      { kind: "click-at", xFraction: 0.5, yFraction: 0.5, resolveOnly: true },
      new Map(),
    );

    expect(result.ok).toBe(true);
    expect(result.resolvedTarget).toEqual({ role: "button", name: "Verwijder account" });
    expect(clicked).toBe(false); // resolveOnly klikt NIET
  });

  it("identificeert een onschuldig doelwit (link) zonder te klikken", async () => {
    document.body.innerHTML = `<a href="/meer" id="link">Lees meer</a>`;
    const link = document.getElementById("link") as HTMLAnchorElement;
    let clicked = false;
    link.addEventListener("click", (e) => { e.preventDefault(); clicked = true; });
    document.elementFromPoint = () => link;

    const result = await executeAction(
      { kind: "click-at", xFraction: 0.2, yFraction: 0.3, resolveOnly: true },
      new Map(),
    );

    expect(result.ok).toBe(true);
    expect(result.resolvedTarget).toEqual({ role: "link", name: "Lees meer" });
    expect(clicked).toBe(false);
  });

  it("identificeert een doelwit dat op betalen/bestellen lijkt zonder het te blokkeren — de companion-poort beslist, niet de extensie zelf", async () => {
    // resolveOnly geeft alleen feiten terug (rol + naam); de deny-beslissing hoort bij
    // checkDenied()/needsConfirm() in de companion (guardrails.ts), niet dubbel hier.
    document.body.innerHTML = `<button id="order">Plaats bestelling</button>`;
    const btn = document.getElementById("order") as HTMLButtonElement;
    document.elementFromPoint = () => btn;

    const result = await executeAction(
      { kind: "click-at", xFraction: 0.5, yFraction: 0.9, resolveOnly: true },
      new Map(),
    );

    expect(result.ok).toBe(true);
    expect(result.resolvedTarget).toEqual({ role: "button", name: "Plaats bestelling" });
  });

  it("geeft eerlijk falen terug als er niets op die positie staat, in plaats van een leeg doelwit te verzinnen", async () => {
    document.elementFromPoint = () => null;
    const result = await executeAction(
      { kind: "click-at", xFraction: 0.5, yFraction: 0.5, resolveOnly: true },
      new Map(),
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("geen element gevonden");
    expect(result.resolvedTarget).toBeUndefined();
  });
});

describe("executeAction click-at — echte klik (na resolveOnly + bevestiging aan de companion-kant)", () => {
  it("klikt een onschuldig doelwit gewoon door (geen regressie: bestaand gedrag blijft werken)", async () => {
    document.body.innerHTML = `<a href="/meer" id="link">Lees meer</a>`;
    const link = document.getElementById("link") as HTMLAnchorElement;
    let clicked = false;
    link.addEventListener("click", (e) => { e.preventDefault(); clicked = true; });
    document.elementFromPoint = () => link;

    const result = await executeAction({ kind: "click-at", xFraction: 0.2, yFraction: 0.3 }, new Map());

    expect(result.ok).toBe(true);
    expect(clicked).toBe(true);
  });

  it("blokkeert een betaal-/bestel-doelwit op het WERKELIJKE klikmoment, ook al is resolveOnly hier geen gok meer (defense-in-depth blijft bestaan)", async () => {
    document.body.innerHTML = `<button id="order">Plaats bestelling</button>`;
    const btn = document.getElementById("order") as HTMLButtonElement;
    let clicked = false;
    btn.addEventListener("click", () => (clicked = true));
    document.elementFromPoint = () => btn;

    const result = await executeAction({ kind: "click-at", xFraction: 0.5, yFraction: 0.9 }, new Map());

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("betalen/bestellen/verwijderen");
    expect(clicked).toBe(false);
  });

  it("blokkeert nog steeds als de pagina tussen resolve en klik is veranderd naar een ander betaal-doelwit (TOCTOU)", async () => {
    // Simuleert het gat dat de tweede laag (DENY_WORDS op het echte klikmoment) moet
    // dichten: de resolve-ronde zag ooit iets onschuldigs, maar tegen de tijd dat de
    // mens bevestigt en de ECHTE klik binnenkomt, staat er iets anders op die positie.
    document.body.innerHTML = `<button id="order">Bevestig bestelling</button>`;
    const btn = document.getElementById("order") as HTMLButtonElement;
    let clicked = false;
    btn.addEventListener("click", () => (clicked = true));
    document.elementFromPoint = () => btn;

    const result = await executeAction({ kind: "click-at", xFraction: 0.5, yFraction: 0.9 }, new Map());

    expect(result.ok).toBe(false);
    expect(clicked).toBe(false);
  });
});
