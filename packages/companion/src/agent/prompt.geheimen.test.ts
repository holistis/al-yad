import { describe, it, expect } from "vitest";
import { buildMessages, type HistoryItem } from "./prompt.js";
import type { Snapshot } from "@yad/shared";

/**
 * Getypte geheimen mogen niet in de prompt naar het taalmodel belanden.
 *
 * De waarneming maskeert wachtwoordvelden inmiddels aan de kant van de extensie, maar de
 * actie-geschiedenis liep daar omheen: die logt de uitgevoerde actie, en bij `type` staat
 * de getypte tekst daar letterlijk in. Typte de agent een wachtwoord, dan ging dat alsnog
 * naar de cloudprovider mee. Twee lekken op één gegeven, en één dichten is dus niet genoeg.
 *
 * Deze tests kijken naar de daadwerkelijk opgebouwde tekst van het bericht, niet naar een
 * hulpfunctie. Dat is bewust: het gaat erom wat er de deur uit gaat, niet of een
 * losstaande functie het goede doet.
 */

const SNAP: Snapshot = {
  url: "https://voorbeeld.nl/inloggen",
  title: "Inloggen",
  nodes: [],
  textDigest: "Inloggen bij het portaal",
} as unknown as Snapshot;

function promptTekst(history: HistoryItem[]): string {
  const berichten = buildMessages("log in op het portaal", SNAP, history);
  return berichten.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
}

function typActie(ref: string, text: string, reason?: string): HistoryItem {
  return { action: { kind: "type", ref, text, ...(reason ? { reason } : {}) } as never, ok: true };
}

describe("geheimen worden uit de actie-geschiedenis gehouden", () => {
  it("verbergt tekst die in een wachtwoordveld is getypt", () => {
    const t = promptTekst([typActie("wachtwoord-veld", "Zomer2026!Geheim")]);
    expect(t).not.toContain("Zomer2026!Geheim");
    expect(t).toContain("verborgen");
  });

  it("herkent het veld ook aan het Engelse woord", () => {
    expect(promptTekst([typActie("input-password", "hunter2xyz")])).not.toContain("hunter2xyz");
  });

  it("herkent het ook aan de toelichting bij de actie", () => {
    const t = promptTekst([typActie("veld-7", "123456", "vul de otp-code in")]);
    expect(t).not.toContain("123456");
  });

  it("verbergt ook pincode, cvv en api-key", () => {
    expect(promptTekst([typActie("pincode", "4821")])).not.toContain("4821");
    expect(promptTekst([typActie("cvv", "731")])).not.toContain("731");
    expect(promptTekst([typActie("api-key-veld", "sk-abc123")])).not.toContain("sk-abc123");
  });

  it("noemt wel de lengte, want het model moet weten dat er iets staat", () => {
    expect(promptTekst([typActie("wachtwoord", "abcdefgh")])).toContain("8 tekens");
  });

  /**
   * Controletest. Zonder deze zou een kapotte maskering die ALLE getypte tekst weggooit
   * ook alle tests hierboven laten slagen, terwijl het model dan blind wordt voor gewone
   * invoer zoals een zoekterm of een klantnummer.
   */
  it("controle: gewone getypte tekst blijft gewoon zichtbaar", () => {
    const t = promptTekst([typActie("zoekveld", "factuur maart 2026")]);
    expect(t).toContain("factuur maart 2026");
  });

  it("controle: de actiesoort zelf blijft leesbaar, alleen de inhoud gaat weg", () => {
    const t = promptTekst([typActie("wachtwoord", "geheim123")]);
    expect(t).toContain("type");
    expect(t).toContain("wachtwoord");
  });
});
