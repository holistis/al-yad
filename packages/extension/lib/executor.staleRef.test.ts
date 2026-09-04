import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeAction } from "./executor";

// jsdom heeft geen echte hit-testing: elementFromPoint geeft altijd null terug, dus
// clickAtViewportPoint valt terug op het meegegeven element zelf — precies het pad dat
// deze tests raken. getBoundingClientRect moet een niet-lege rect geven, anders wordt
// het "doelwit" als onzichtbaar verworpen door findFresh.
beforeEach(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("executeAction click — herstel bij een verouderde ref", () => {
  it("klikt het echte, huidige element als de refMap-verwijzing losgekoppeld is (stale)", async () => {
    document.body.innerHTML = `<button id="live">Add domain</button>`;
    const liveBtn = document.getElementById("live") as HTMLButtonElement;
    let clicked = false;
    liveBtn.addEventListener("click", () => (clicked = true));

    // Simuleer een refMap die nog naar een OUD, inmiddels losgekoppeld knooppunt wijst
    // (React verving het element, refMap.get() geeft het oude, dode DOM-object terug).
    const staleEl = document.createElement("button");
    staleEl.textContent = "Add domain";
    // Nooit aan document toegevoegd → isConnected is false, precies zoals na een re-render.
    expect(staleEl.isConnected).toBe(false);

    const refMap = new Map<string, Element>([["e1", staleEl]]);
    const labelMap = new Map([["e1", { role: "button", name: "Add domain" }]]);

    const result = await executeAction({ kind: "click", ref: "e1" }, refMap, labelMap);

    expect(result.ok).toBe(true);
    expect(clicked).toBe(true);
  });

  it("faalt eerlijk als de ref weg is EN er geen labelMap-info is om op terug te vallen", async () => {
    const refMap = new Map<string, Element>();
    const result = await executeAction({ kind: "click", ref: "e1" }, refMap);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("niet gevonden");
  });

  it("faalt eerlijk als zelfs de verse zoekactie niets oplevert", async () => {
    document.body.innerHTML = ""; // niets op de pagina
    const refMap = new Map<string, Element>();
    const labelMap = new Map([["e1", { role: "button", name: "Bestaat niet" }]]);
    const result = await executeAction({ kind: "click", ref: "e1" }, refMap, labelMap);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("niet gevonden");
  });

  it("gebruikt gewoon de refMap-verwijzing als die nog geldig is (geen onnodige herzoekactie)", async () => {
    document.body.innerHTML = `<button id="live">Add domain</button>`;
    const liveBtn = document.getElementById("live") as HTMLButtonElement;
    let clicked = false;
    liveBtn.addEventListener("click", () => (clicked = true));

    const refMap = new Map<string, Element>([["e1", liveBtn]]);
    // Bewust GEEN labelMap-entry voor e1 — als de code toch op findFresh zou steunen
    // terwijl dat niet nodig was, zou dit pad falen en de test dat blootleggen.
    const result = await executeAction({ kind: "click", ref: "e1" }, refMap, new Map());

    expect(result.ok).toBe(true);
    expect(clicked).toBe(true);
  });
});
