import { describe, it, expect, afterEach } from "vitest";
import { roleOf } from "./perception";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("roleOf — niet-semantisch klikbaar element krijgt een WRITE_ROLES-herkenbare rol (adversariele review 2026-09-11, finding 25)", () => {
  it("geeft 'button' terug voor een div met onclick, niet de kale tagnaam 'div'", () => {
    document.body.innerHTML = `<div onclick="submitOrder()">Bevestig betaling</div>`;
    const el = document.querySelector("div")!;
    expect(roleOf(el)).toBe("button");
  });

  it("geeft 'button' terug voor een span met onclick", () => {
    document.body.innerHTML = `<span onclick="doIets()">Klik hier</span>`;
    const el = document.querySelector("span")!;
    expect(roleOf(el)).toBe("button");
  });

  it("laat een expliciete ARIA-rol op een div gewoon voorgaan", () => {
    document.body.innerHTML = `<div onclick="doIets()" role="checkbox">Aanvinken</div>`;
    const el = document.querySelector("div")!;
    expect(roleOf(el)).toBe("checkbox");
  });

  it("blijft de kale tagnaam teruggeven voor een div zonder onclick (geen regressie)", () => {
    document.body.innerHTML = `<div tabindex="0">Alleen focusbaar, geen klik-handler</div>`;
    const el = document.querySelector("div")!;
    expect(roleOf(el)).toBe("div");
  });

  it("blijft echte, semantische elementen ongewijzigd classificeren", () => {
    document.body.innerHTML = `<button onclick="doIets()">Echte knop</button>`;
    const el = document.querySelector("button")!;
    expect(roleOf(el)).toBe("button");
  });
});
