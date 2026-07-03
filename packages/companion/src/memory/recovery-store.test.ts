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
    expect(store.readAll()).toHaveLength(3);
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
