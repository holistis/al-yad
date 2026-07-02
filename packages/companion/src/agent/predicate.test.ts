import { describe, it, expect } from "vitest";
import type { Snapshot } from "@yad/shared";
import {
  evaluatePredicate,
  evaluatePredicates,
  parsePredicate,
  parsePredicates,
  type Predicate,
} from "./predicate.js";

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    url: "https://www.saucedemo.com/checkout-step-one.html",
    title: "Checkout",
    nodes: [
      { ref: "e1", role: "textbox", name: "First Name" },
      { ref: "e2", role: "textbox", name: "Last Name" },
      { ref: "e3", role: "button", name: "Continue" },
    ],
    textDigest: "Checkout: Your Information First Name Last Name Zip Code Continue Cancel",
    ...over,
  };
}

describe("evaluatePredicate", () => {
  it("url-contains: match op deelstring, mismatch anders", () => {
    expect(evaluatePredicate({ type: "url-contains", value: "/checkout" }, snap())).toBe("match");
    expect(evaluatePredicate({ type: "url-contains", value: "/cart" }, snap())).toBe("mismatch");
  });

  it("url-contains: hoofdletterongevoelig", () => {
    expect(evaluatePredicate({ type: "url-contains", value: "/CHECKOUT" }, snap())).toBe("match");
  });

  it("role-present: match als element bestaat, mismatch anders", () => {
    expect(evaluatePredicate({ type: "role-present", role: "button", nameSubstring: "Continue" }, snap())).toBe("match");
    expect(evaluatePredicate({ type: "role-present", role: "button", nameSubstring: "Finish" }, snap())).toBe("mismatch");
  });

  it("role-absent: match als element ontbreekt (login-knop weg = ingelogd)", () => {
    expect(evaluatePredicate({ type: "role-absent", role: "button", nameSubstring: "Login" }, snap())).toBe("match");
    expect(evaluatePredicate({ type: "role-absent", role: "button", nameSubstring: "Continue" }, snap())).toBe("mismatch");
  });

  it("field-any-filled: mismatch bij leeg, match zodra een veld gevuld is", () => {
    expect(evaluatePredicate({ type: "field-any-filled", min: 1 }, snap())).toBe("mismatch");
    const filled = snap({
      nodes: [
        { ref: "e1", role: "textbox", name: "First Name", value: "Test" },
        { ref: "e2", role: "textbox", name: "Last Name" },
        { ref: "e3", role: "button", name: "Continue" },
      ],
    });
    expect(evaluatePredicate({ type: "field-any-filled", min: 1 }, filled)).toBe("match");
  });

  it("text-present: match als gevonden, indeterminate als niet (afkap-veilig, nooit hard mismatch)", () => {
    expect(evaluatePredicate({ type: "text-present", value: "First Name" }, snap())).toBe("match");
    expect(evaluatePredicate({ type: "text-present", value: "Thank you for your order" }, snap())).toBe("indeterminate");
  });

  it("text-absent: mismatch als tekst tóch aanwezig, indeterminate als niet gevonden", () => {
    expect(evaluatePredicate({ type: "text-absent", value: "Continue" }, snap())).toBe("mismatch");
    expect(evaluatePredicate({ type: "text-absent", value: "Error" }, snap())).toBe("indeterminate");
  });

  it("is puur: twee keer aanroepen geeft identiek resultaat", () => {
    const p: Predicate = { type: "url-contains", value: "/checkout" };
    const s = snap();
    expect(evaluatePredicate(p, s)).toBe(evaluatePredicate(p, s));
  });
});

describe("evaluatePredicates (AND-semantiek)", () => {
  it("lege set → indeterminate (nooit blind match)", () => {
    expect(evaluatePredicates([], snap()).verdict).toBe("indeterminate");
  });

  it("alle match → match", () => {
    const r = evaluatePredicates(
      [
        { type: "url-contains", value: "/checkout" },
        { type: "role-present", role: "button", nameSubstring: "Continue" },
      ],
      snap(),
    );
    expect(r.verdict).toBe("match");
    expect(r.matched).toBe(2);
  });

  it("één harde mismatch → mismatch (kort-sluiting)", () => {
    const r = evaluatePredicates(
      [
        { type: "url-contains", value: "/checkout" },
        { type: "url-contains", value: "/cart" },
      ],
      snap(),
    );
    expect(r.verdict).toBe("mismatch");
  });

  it("match + indeterminate (geen mismatch) → indeterminate", () => {
    const r = evaluatePredicates(
      [
        { type: "url-contains", value: "/checkout" },
        { type: "text-present", value: "Thank you for your order" },
      ],
      snap(),
    );
    expect(r.verdict).toBe("indeterminate");
  });
});

describe("parsePredicate (validatie + ref-verbod)", () => {
  it("verwerpt ELK predicaat dat een ref draagt", () => {
    expect(parsePredicate({ type: "role-present", role: "button", ref: "e3" })).toBeNull();
  });

  it("verwerpt onbekende types", () => {
    expect(parsePredicate({ type: "css-selector", value: ".foo" })).toBeNull();
  });

  it("verwerpt ontbrekende verplichte velden", () => {
    expect(parsePredicate({ type: "url-contains" })).toBeNull();
    expect(parsePredicate({ type: "role-present" })).toBeNull();
  });

  it("accepteert geldige predicaten", () => {
    expect(parsePredicate({ type: "url-contains", value: "/x" })).toEqual({ type: "url-contains", value: "/x" });
    expect(parsePredicate({ type: "field-any-filled" })).toEqual({ type: "field-any-filled" });
    expect(parsePredicate({ type: "field-any-filled", min: 2 })).toEqual({ type: "field-any-filled", min: 2 });
  });

  it("parsePredicates dropt ongeldige exemplaren en houdt geldige", () => {
    const out = parsePredicates([
      { type: "url-contains", value: "/ok" },
      { type: "role-present", role: "button", ref: "e1" }, // ref → gedropt
      { type: "bogus" }, // onbekend → gedropt
      { type: "text-present", value: "hi" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: "url-contains", value: "/ok" });
    expect(out[1]).toEqual({ type: "text-present", value: "hi" });
  });

  it("niet-array input → lege lijst", () => {
    expect(parsePredicates("nope")).toEqual([]);
    expect(parsePredicates(null)).toEqual([]);
  });
});
