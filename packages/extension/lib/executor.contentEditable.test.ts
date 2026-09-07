import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeAction } from "./executor";

// Deze suite dekt het gat dat op 2026-09-07 in productie zichtbaar werd: YAD kreeg
// drie keer op rij de opdracht een YouTube-reactie te plaatsen, rapporteerde drie keer
// succes, en er stond nooit iets in het veld. YouTube's reactieveld is geen textarea
// maar een framework-gestuurd contentEditable-element, en juist die tak had geen
// enkele test.
//
// jsdom heeft geen layout, dus scrollIntoView/getBoundingClientRect worden gestubd
// zoals in de andere executor-suites.
beforeEach(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
});

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * Bootst een framework-gestuurde editor na (YouTube, Lexical, Draft.js, ProseMirror).
 * Zulke editors houden hun eigen interne state bij en negeren een directe
 * textContent-toewijzing: ze schrijven op de eerstvolgende tick hun eigen state
 * terug naar de DOM, waardoor de zojuist gezette tekst weer verdwijnt.
 *
 * Alleen invoer die de browser als échte gebruikersinvoer aanbiedt
 * (execCommand("insertText"), of CDP Input.insertText) werkt de interne state bij.
 */
function maakFrameworkEditor(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("contenteditable", "true");
  Object.defineProperty(el, "isContentEditable", { value: true, configurable: true });

  let interneState = "";

  // Het framework accepteert alleen invoer via execCommand: dat is wat een echte
  // toetsaanslag in een browser produceert.
  document.execCommand = ((cmd: string, _ui?: boolean, waarde?: string): boolean => {
    if (cmd === "selectAll") return true;
    if (cmd === "insertText" && typeof waarde === "string") {
      interneState += waarde;
      el.textContent = interneState;
      return true;
    }
    return false;
  }) as typeof document.execCommand;

  // De terugschrijf-lus: zodra de DOM buiten het framework om is aangepast, herstelt
  // het framework op de volgende tick zijn eigen state. Dit is precies waarom een
  // directe textContent-toewijzing stilletjes verdwijnt.
  const observer = new MutationObserver(() => {
    if (el.textContent !== interneState) {
      el.textContent = interneState;
    }
  });
  observer.observe(el, { childList: true, characterData: true, subtree: true });

  document.body.appendChild(el);
  return el;
}

describe("executeAction type — framework-gestuurd contentEditable-veld", () => {
  it("meldt GEEN succes wanneer de tekst niet in het veld blijft staan", async () => {
    const el = maakFrameworkEditor();
    const refMap = new Map<string, Element>([["e1", el]]);
    const labelMap = new Map([["e1", { role: "textbox", name: "Voeg een reactie toe" }]]);

    const result = await executeAction({ kind: "type", ref: "e1", text: "Dit is mijn reactie" }, refMap, labelMap);

    // Laat de terugschrijf-lus van het framework zijn werk doen, precies zoals in een
    // echte browser gebeurt binnen enkele milliseconden na de DOM-wijziging.
    await new Promise((r) => setTimeout(r, 50));

    // De kern van deze test: als het veld leeg is, mag het resultaat NOOIT ok zijn.
    // Een agent die hierop "klaar" rapporteert liegt tegen zijn gebruiker.
    if (!el.textContent) {
      expect(result.ok).toBe(false);
    } else {
      expect(el.textContent).toBe("Dit is mijn reactie");
      expect(result.ok).toBe(true);
    }
  });

  it("krijgt de tekst er daadwerkelijk in via een methode die het framework accepteert", async () => {
    const el = maakFrameworkEditor();
    const refMap = new Map<string, Element>([["e1", el]]);
    const labelMap = new Map([["e1", { role: "textbox", name: "Voeg een reactie toe" }]]);

    const result = await executeAction({ kind: "type", ref: "e1", text: "Hallo wereld" }, refMap, labelMap);
    await new Promise((r) => setTimeout(r, 50));

    expect(result.ok).toBe(true);
    expect(el.textContent).toBe("Hallo wereld");
  });

  it("werkt onveranderd voor een gewone textarea (geen regressie)", async () => {
    document.body.innerHTML = `<textarea id="t"></textarea>`;
    const el = document.getElementById("t") as HTMLTextAreaElement;
    const refMap = new Map<string, Element>([["e1", el]]);
    const labelMap = new Map([["e1", { role: "textbox", name: "Bericht" }]]);

    const result = await executeAction({ kind: "type", ref: "e1", text: "gewone tekst" }, refMap, labelMap);

    expect(result.ok).toBe(true);
    expect(el.value).toBe("gewone tekst");
  });
});
