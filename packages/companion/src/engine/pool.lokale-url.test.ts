import { describe, it, expect } from "vitest";
import { buildPool, isLokaleUrl, staatOpAlleenLokaal } from "./pool.js";

/**
 * Het gat onder de lokale stand: WAAR draait "lokaal" eigenlijk?
 *
 * pool.lokaal.test.ts bewijst dat er geen cloudprovider in de pool zit. Dat bleek niet
 * genoeg. De stand hield één provider over, Ollama, en pakte diens adres klakkeloos uit
 * OLLAMA_BASE_URL. Op de machine van de eigenaar stond daar een eigen server in Frankfurt,
 * over gewoon http. De stand die belooft dat er niets weggaat, stuurde dus de volledige
 * paginatekst onversleuteld het internet op — en de bestaande test zag dat niet, want die
 * telde alleen providers en keek niet naar hun adres.
 *
 * Les die hier vastgelegd wordt: een belofte toetsen op de vorm (welke providers) is niet
 * hetzelfde als toetsen op de uitkomst (verlaat data de machine). Deze tests toetsen de
 * uitkomst.
 */

const LOKAAL = { YAD_LOKAAL: "1" } as Record<string, string>;

describe("isLokaleUrl", () => {
  it("herkent adressen op deze computer", () => {
    for (const u of [
      "http://localhost:11434/v1",
      "http://127.0.0.1:11434/v1",
      "https://localhost/v1",
      "http://[::1]:11434/v1",
    ]) {
      expect(isLokaleUrl(u), u).toBe(true);
    }
  });

  it("herkent adressen buiten deze computer", () => {
    for (const u of [
      "http://138.201.204.97:11434/v1", // de echte waarde die het gat blootlegde
      "https://api.groq.com/openai/v1",
      "http://192.168.1.50:11434/v1", // ander apparaat in huis is ook niet deze computer
      "onzin",
    ]) {
      expect(isLokaleUrl(u), u).toBe(false);
    }
  });
});

describe("lokale stand weigert een Ollama buiten deze computer", () => {
  it("gooit een fout bij een adres op afstand, in plaats van stil door te gaan", () => {
    expect(() =>
      buildPool({ ...LOKAAL, OLLAMA_BASE_URL: "http://138.201.204.97:11434/v1" } as never),
    ).toThrow(/geen adres op deze computer/i);
  });

  it("noemt in de fout het adres én hoe je het oplost", () => {
    let bericht = "";
    try {
      buildPool({ ...LOKAAL, OLLAMA_BASE_URL: "http://138.201.204.97:11434/v1" } as never);
    } catch (e) {
      bericht = String(e);
    }
    expect(bericht).toContain("138.201.204.97");
    expect(bericht).toContain("localhost");
  });

  it("laat een echt lokaal adres gewoon door", () => {
    const p = buildPool({ ...LOKAAL, OLLAMA_BASE_URL: "http://localhost:11434/v1" } as never);
    expect(p).toHaveLength(1);
    expect(p[0]?.name).toBe("ollama");
  });

  it("werkt ook zonder OLLAMA_BASE_URL, want de standaard is localhost", () => {
    expect(() => buildPool({ ...LOKAAL } as never)).not.toThrow();
  });

  /**
   * Controletest. Zonder deze zou een kapotte buildPool die altijd gooit ook alle tests
   * hierboven laten slagen, en zou een kapotte staatOpAlleenLokaal die altijd false geeft
   * ongemerkt de hele bewaking uitschakelen.
   */
  it("controle: zonder de lokale stand is een adres op afstand gewoon toegestaan", () => {
    expect(staatOpAlleenLokaal({} as never)).toBe(false);
    expect(() =>
      buildPool({ OLLAMA_BASE_URL: "http://138.201.204.97:11434/v1" } as never),
    ).not.toThrow();
  });
});
