import { describe, it, expect, beforeAll } from "vitest";
import type { urlMatchesAdoptPattern as UrlMatchesAdoptPatternFn } from "./native-port";

/**
 * Regressietest voor de adversariele review (2026-09-11): /adopt-tab matchte met een
 * kale url.includes(pattern), dus een pattern "amazon.com" matchte ook een
 * kijk-alikedomein dat die tekst toevallig als substring bevat. Bij een kale
 * hostname-achtig pattern matchen we voortaan op de echte hostname.
 *
 * native-port.ts roept bij het laden meteen volgDownloads() aan, dat chrome.downloads
 * leest (zie resolveRunTab-test hiernaast) — dus eerst een minimale chrome-stub zetten,
 * dan pas importeren.
 */
let urlMatchesAdoptPattern: typeof UrlMatchesAdoptPatternFn;

beforeAll(async () => {
  (globalThis as { chrome?: unknown }).chrome = {
    downloads: undefined,
    tabs: { query: async () => [] },
  };
  const mod = await import("./native-port");
  urlMatchesAdoptPattern = mod.urlMatchesAdoptPattern;
});

describe("urlMatchesAdoptPattern — geen kijk-alikedomein-verwarring bij /adopt-tab", () => {
  it("matcht de echte hostname en subdomeinen ervan", () => {
    expect(urlMatchesAdoptPattern("https://www.amazon.com/gp/cart", "amazon.com")).toBe(true);
    expect(urlMatchesAdoptPattern("https://amazon.com/", "amazon.com")).toBe(true);
    expect(urlMatchesAdoptPattern("https://checkout.amazon.com/", "amazon.com")).toBe(true);
  });

  it("weigert een kijk-alikedomein dat het pattern alleen als substring bevat", () => {
    expect(urlMatchesAdoptPattern("https://scam-amazon.com.evil.ru/phish", "amazon.com")).toBe(false);
    expect(urlMatchesAdoptPattern("https://notamazon.com/", "amazon.com")).toBe(false);
  });

  it("blijft de oude substring-match gebruiken voor patronen met pad/query (bv. een sessie-id)", () => {
    expect(urlMatchesAdoptPattern("https://voorbeeld.nl/checkout?session=abc123", "session=abc123")).toBe(true);
    expect(urlMatchesAdoptPattern("https://voorbeeld.nl/orders/42", "/orders/42")).toBe(true);
  });

  it("geeft false terug bij een niet-parseerbare URL met een hostname-achtig pattern", () => {
    expect(urlMatchesAdoptPattern("chrome://newtab", "amazon.com")).toBe(false);
  });
});
