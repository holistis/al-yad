import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeAction } from "./executor";

beforeEach(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("executeAction click — robuust tegen een niet-aanroepbare .click()", () => {
  it("valt terug op een synthetische muisklik als .click() geen functie is", async () => {
    document.body.innerHTML = `<button id="odd">Add record</button>`;
    const el = document.getElementById("odd") as HTMLButtonElement;

    // Bootst het echte, live gevonden probleem na: een geldig, verbonden element
    // waarvan .click() om wat voor reden dan ook niet aanroepbaar is op het moment
    // van klikken. Ontdekt op Cloudflare's dashboard, 2026-08-29.
    Object.defineProperty(el, "click", { value: "geen functie, gewoon een string" });

    let sawSyntheticClick = false;
    el.addEventListener("click", () => (sawSyntheticClick = true));

    const refMap = new Map<string, Element>([["e1", el]]);
    const result = await executeAction({ kind: "click", ref: "e1" }, refMap);

    expect(result.ok).toBe(true);
    expect(sawSyntheticClick).toBe(true);
  });

  it("gebruikt gewoon de native .click() als die wel werkt (geen onnodige omweg)", async () => {
    document.body.innerHTML = `<button id="normal">Add record</button>`;
    const el = document.getElementById("normal") as HTMLButtonElement;
    let clicks = 0;
    el.addEventListener("click", () => clicks++);

    const refMap = new Map<string, Element>([["e1", el]]);
    const result = await executeAction({ kind: "click", ref: "e1" }, refMap);

    expect(result.ok).toBe(true);
    // Native click() vuurt precies één keer; bij een dubbele (native + synthetisch)
    // zou dit er twee zijn geweest.
    expect(clicks).toBe(1);
  });
});
