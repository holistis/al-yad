import { describe, it, expect, beforeEach } from "vitest";
import { RecoveryStore } from "./recovery-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "yad-recovery-"));
}

describe("RecoveryStore — lege store", () => {
  it("get geeft null als de sleutel onbekend is", () => {
    const store = new RecoveryStore(tempDir());
    expect(store.get("saucedemo.com", "repeat")).toBeNull();
  });

  it("readAll geeft lege array terug", () => {
    const store = new RecoveryStore(tempDir());
    expect(store.readAll()).toHaveLength(0);
  });
});

describe("RecoveryStore — record + get", () => {
  let dir: string;
  beforeEach(() => { dir = tempDir(); });

  it("na record() geeft get() de bewezen hint terug", () => {
    const store = new RecoveryStore(dir);
    store.record("saucedemo.com", "repeat", "probeer via navigeer-actie i.p.v. klik");
    expect(store.get("saucedemo.com", "repeat")).toBe("probeer via navigeer-actie i.p.v. klik");
  });

  it("andere sleutel geeft null", () => {
    const store = new RecoveryStore(dir);
    store.record("saucedemo.com", "repeat", "hint A");
    expect(store.get("saucedemo.com", "state-loop")).toBeNull();
    expect(store.get("other.nl", "repeat")).toBeNull();
  });

  it("provenCount begint op 1", () => {
    const store = new RecoveryStore(dir);
    store.record("saucedemo.com", "repeat", "hint");
    expect(store.readAll()[0]?.provenCount).toBe(1);
  });

  it("tweede record() verhoogt provenCount en vervangt hint", () => {
    const store = new RecoveryStore(dir);
    store.record("saucedemo.com", "repeat", "eerste hint");
    store.record("saucedemo.com", "repeat", "betere hint");
    expect(store.get("saucedemo.com", "repeat")).toBe("betere hint");
    expect(store.readAll()[0]?.provenCount).toBe(2);
  });

  it("meerdere keys coexisteren onafhankelijk", () => {
    const store = new RecoveryStore(dir);
    store.record("shop.nl", "repeat", "hint-A");
    store.record("shop.nl", "state-loop", "hint-B");
    store.record("bank.nl", "repeat", "hint-C");
    expect(store.get("shop.nl", "repeat")).toBe("hint-A");
    expect(store.get("shop.nl", "state-loop")).toBe("hint-B");
    expect(store.get("bank.nl", "repeat")).toBe("hint-C");
    // 3 tier-1 entries + 1 tier-2 entry (*|repeat, gepromoveerd via shop.nl + bank.nl)
    const realEntries = store.readAll().filter(e => e.sitePattern !== "*" && e.sitePattern !== "**");
    expect(realEntries).toHaveLength(3);
  });
});

describe("RecoveryStore — persistentie (herlaad uit JSONL)", () => {
  it("na heropstarten leest de store de index opnieuw uit de JSONL", () => {
    const dir = tempDir();
    const store1 = new RecoveryStore(dir);
    store1.record("saucedemo.com", "no-progress", "wacht 2s en probeer opnieuw");

    // Tweede instantie op dezelfde map = heropstart-simulatie
    const store2 = new RecoveryStore(dir);
    expect(store2.get("saucedemo.com", "no-progress")).toBe("wacht 2s en probeer opnieuw");
  });

  it("herlaad respecteert de provenCount van de laatste entry", () => {
    const dir = tempDir();
    const store1 = new RecoveryStore(dir);
    store1.record("x.nl", "repeat", "hint v1");
    store1.record("x.nl", "repeat", "hint v2"); // count wordt 2

    const store2 = new RecoveryStore(dir);
    store2.record("x.nl", "repeat", "hint v3"); // count wordt 3
    expect(store2.readAll()[0]?.provenCount).toBe(3);
  });
});

describe("RecoveryStore — drie-laags lookup (tier-1 / tier-2 / tier-3)", () => {
  it("tier-1: exact site-match heeft altijd prioriteit", () => {
    const store = new RecoveryStore(tempDir());
    store.record("saucedemo.com", "repeat", "site-specifiek plan");
    expect(store.get("saucedemo.com", "repeat")).toBe("site-specifiek plan");
  });

  it("tier-2: cross-domain na ≥2 unieke sites voor zelfde signaal", () => {
    const store = new RecoveryStore(tempDir());
    store.record("saucedemo.com", "repeat", "hint-A", "navigation-instability");
    // Nog maar 1 site → nog geen tier-2
    expect(store.get("shop.nl", "repeat")).toBeNull();

    store.record("shop.nl", "repeat", "hint-B", "navigation-instability");
    // Nu 2 sites → tier-2 gepromoveerd
    expect(store.get("other.nl", "repeat")).not.toBeNull();
  });

  it("tier-2 geeft null terug als slechts 1 site bewezen is", () => {
    const store = new RecoveryStore(tempDir());
    store.record("saucedemo.com", "state-loop", "hint", "navigation-instability");
    expect(store.get("other.nl", "state-loop")).toBeNull();
  });

  it("tier-3: cross-class na ≥2 unieke sites voor zelfde class", () => {
    const store = new RecoveryStore(tempDir());
    store.record("saucedemo.com", "repeat", "hint-A", "navigation-instability");
    store.record("shop.nl", "state-loop", "hint-B", "navigation-instability");
    // 2 sites, zelfde klasse, maar andere signalen → tier-3 gepromoveerd
    expect(store.get("unknown.io", "url-regression", "navigation-instability")).not.toBeNull();
  });

  it("tier-3 geeft null als failureClass niet meegegeven in get()", () => {
    const store = new RecoveryStore(tempDir());
    store.record("saucedemo.com", "repeat", "hint-A", "navigation-instability");
    store.record("shop.nl", "state-loop", "hint-B", "navigation-instability");
    // Zelfde class gepromoveerd maar get() krijgt geen failureClass mee → null voor tier-3
    expect(store.get("unknown.io", "url-regression")).toBeNull();
  });

  it("tier-1 wint van tier-2 als beide bestaan", () => {
    const store = new RecoveryStore(tempDir());
    store.record("saucedemo.com", "repeat", "globale-hint", "navigation-instability");
    store.record("shop.nl", "repeat", "shop-hint", "navigation-instability");
    // tier-2 actief; nu specifiek voor saucedemo een betere hint zetten
    store.record("saucedemo.com", "repeat", "site-specifieke-hint", "navigation-instability");
    expect(store.get("saucedemo.com", "repeat")).toBe("site-specifieke-hint");
  });

  it("promotie-tellers overleven een herlaad (persistentie)", () => {
    const dir = tempDir();
    const store1 = new RecoveryStore(dir);
    store1.record("saucedemo.com", "repeat", "hint-A", "navigation-instability");
    store1.record("shop.nl", "repeat", "hint-B", "navigation-instability");

    // Herlaad: tier-2 moet nog steeds beschikbaar zijn
    const store2 = new RecoveryStore(dir);
    expect(store2.get("other.nl", "repeat")).not.toBeNull();
  });
});
