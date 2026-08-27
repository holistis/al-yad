import { describe, it, expect } from "vitest";
import { normalizeText, SNAPSHOT_LIMITS } from "@yad/shared";

describe("normalizeText", () => {
  it("laat gewone tekst ongemoeid", () => {
    expect(normalizeText("Hallo wereld")).toBe("Hallo wereld");
  });

  it("vouwt meerdere spaties samen tot één", () => {
    expect(normalizeText("te  veel   spaties")).toBe("te veel spaties");
  });

  it("trimt voor- en achterkant", () => {
    expect(normalizeText("  rand  ")).toBe("rand");
  });

  it("vouwt tabs en newlines ook samen", () => {
    expect(normalizeText("regel1\n\nregel2\t\tregel3")).toBe("regel1 regel2 regel3");
  });

  it("stript zero-width space (U+200B)", () => {
    const met = "hel​lo";
    expect(normalizeText(met)).toBe("hello");
  });

  it("stript BOM (U+FEFF)", () => {
    expect(normalizeText("﻿tekst")).toBe("tekst");
  });

  it("stript bidi-controls (U+202A t/m U+202E)", () => {
    const met = "‪tekst‮";
    expect(normalizeText(met)).toBe("tekst");
  });

  it("stript word-joiner (U+2060)", () => {
    expect(normalizeText("woord⁠woord")).toBe("woordwoord");
  });

  it("geeft lege string terug voor lege input", () => {
    expect(normalizeText("")).toBe("");
  });

  it("geeft lege string terug voor alleen-witruimte", () => {
    expect(normalizeText("   \t\n  ")).toBe("");
  });

  it("is deterministisch: zelfde input → zelfde output", () => {
    const s = "  test​  tekst\n\n meer  ";
    expect(normalizeText(s)).toBe(normalizeText(s));
  });

  it("bewaart originele hoofdletters (geen lowercase)", () => {
    expect(normalizeText("EERSTE Naam")).toBe("EERSTE Naam");
  });

  it("combineert: invisible + whitespace + trim tegelijk", () => {
    const vuil = "  ﻿ Hallo​  \n\n Wereld‪  ";
    expect(normalizeText(vuil)).toBe("Hallo Wereld");
  });
});

describe("SNAPSHOT_LIMITS", () => {
  it("DIGEST_LIMIT is 3000 (verhoogd voor Wikipedia-infobox-bereikbaarheid)", () => {
    expect(SNAPSHOT_LIMITS.DIGEST_LIMIT).toBe(3000);
  });

  it("NAME_LIMIT is 120", () => {
    expect(SNAPSHOT_LIMITS.NAME_LIMIT).toBe(120);
  });

  it("MAX_NODES is 500", () => {
    expect(SNAPSHOT_LIMITS.MAX_NODES).toBe(500);
  });

  it("truncatie-invariant: normalizeText(s).slice(0, DIGEST_LIMIT) heeft max DIGEST_LIMIT tekens", () => {
    const lang = "a".repeat(3000);
    const result = normalizeText(lang).slice(0, SNAPSHOT_LIMITS.DIGEST_LIMIT);
    expect(result.length).toBeLessThanOrEqual(SNAPSHOT_LIMITS.DIGEST_LIMIT);
  });
});

describe("twee-Handen pariteit (scenario)", () => {
  it("dezelfde ruwe tekst via beide Handen geeft identieke textDigest", () => {
    // Simuleert: Extension-hand doet normalizeText().slice(1500)
    // Playwright-hand doet normalizeText().slice(1500)
    // Beide beginnen met dezelfde ruwe innerText — uitkomst moet identiek zijn.
    const rawPageText = "  Checkout​: Your Information\n\nFirst Name  Last Name  Zip  ";

    const extensionDigest = normalizeText(rawPageText).slice(0, SNAPSHOT_LIMITS.DIGEST_LIMIT);
    const playwrightDigest = normalizeText(rawPageText).slice(0, SNAPSHOT_LIMITS.DIGEST_LIMIT);

    expect(extensionDigest).toBe(playwrightDigest);
    expect(extensionDigest).toBe("Checkout: Your Information First Name Last Name Zip");
  });

  it("invisible chars in namen: extension en playwright geven zelfde node-naam", () => {
    const rauweNaam = "  Doorgaan​ naar betalen  ";
    const extensionNaam = normalizeText(rauweNaam).slice(0, SNAPSHOT_LIMITS.NAME_LIMIT);
    const playwrightNaam = normalizeText(rauweNaam).slice(0, SNAPSHOT_LIMITS.NAME_LIMIT);
    expect(extensionNaam).toBe(playwrightNaam);
    expect(extensionNaam).toBe("Doorgaan naar betalen");
  });
});
