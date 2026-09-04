import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findFresh } from "./perception";

// jsdom geeft standaard een 0x0 rect terug (geen echte layout-engine), en isVisible()
// verwerpt dat als "onzichtbaar". Voor deze tests doet de werkelijke grootte er niet
// toe, dus altijd een niet-lege rect teruggeven.
beforeEach(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findFresh", () => {
  it("vindt een element opnieuw op exacte rol+naam", () => {
    document.body.innerHTML = `<button>Add domain</button><button>Buy domain</button>`;
    const found = findFresh(document, "button", "Add domain");
    expect(found?.textContent).toBe("Add domain");
  });

  it("negeert onzichtbare elementen met dezelfde naam", () => {
    document.body.innerHTML = `<button style="display:none">Add domain</button>`;
    const found = findFresh(document, "button", "Add domain");
    expect(found).toBeNull();
  });

  it("valt terug op naam-match als de rol licht afwijkt, maar geeft de voorkeur aan een exacte match", () => {
    document.body.innerHTML = `<a href="#">Add domain</a><button>Add domain</button>`;
    const found = findFresh(document, "button", "Add domain");
    expect(found?.tagName).toBe("BUTTON");
  });

  it("gebruikt de naam-match als er geen enkele rol-overeenkomst is", () => {
    document.body.innerHTML = `<a href="#">Add domain</a>`;
    const found = findFresh(document, "button", "Add domain");
    expect(found?.tagName).toBe("A");
  });

  it("geeft null terug zonder naam om op te zoeken", () => {
    document.body.innerHTML = `<button>Add domain</button>`;
    expect(findFresh(document, "button", "")).toBeNull();
    expect(findFresh(document, "button", "   ")).toBeNull();
  });

  it("geeft null terug als niets overeenkomt", () => {
    document.body.innerHTML = `<button>Something else</button>`;
    expect(findFresh(document, "button", "Add domain")).toBeNull();
  });

  it("is niet hoofdlettergevoelig en negeert omringende spaties", () => {
    document.body.innerHTML = `<button>  ADD DOMAIN  </button>`;
    const found = findFresh(document, "button", "add domain");
    expect(found).not.toBeNull();
  });
});
