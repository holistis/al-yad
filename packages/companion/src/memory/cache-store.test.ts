import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { CacheStore, hashGoal, makeCacheKey, urlToPattern, TTL_MS } from "./cache-store.js";
import type { Action } from "@yad/shared";

const ACTIONS: Action[] = [
  { kind: "navigate", url: "https://shop.nl/producten" },
  { kind: "click", ref: "e1" },
  { kind: "extract", what: "prijs" },
];

function tempStore(now = () => 1_000_000): CacheStore {
  const dir = mkdtempSync(join(tmpdir(), "yad-cache-"));
  return new CacheStore(dir, now);
}

// ── hashGoal ─────────────────────────────────────────────────────────────────

describe("hashGoal", () => {
  it("is deterministisch voor hetzelfde doel", () => {
    expect(hashGoal("zoek een product")).toBe(hashGoal("zoek een product"));
  });

  it("normaliseert hoofdletters en witruimte", () => {
    expect(hashGoal("  Zoek Een Product  ")).toBe(hashGoal("zoek een product"));
  });

  it("levert 16 hex-tekens", () => {
    expect(hashGoal("x")).toHaveLength(16);
  });
});

// ── urlToPattern ──────────────────────────────────────────────────────────────

describe("urlToPattern", () => {
  it("behoudt de hostname en het niet-numerieke pad", () => {
    expect(urlToPattern("https://shop.nl/producten/kleding")).toBe("shop.nl/producten/kleding");
  });

  it("vervangt numerieke segmenten door *", () => {
    expect(urlToPattern("https://shop.nl/product/12345/details")).toBe("shop.nl/product/*/details");
  });

  it("vervangt een UUID door *", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    expect(urlToPattern(`https://app.nl/items/${uuid}`)).toBe("app.nl/items/*");
  });

  it("valt terug op de eerste 80 tekens bij een ongeldige URL", () => {
    const result = urlToPattern("geen-url");
    expect(result).toBe("geen-url");
  });
});

// ── makeCacheKey ──────────────────────────────────────────────────────────────

describe("makeCacheKey", () => {
  it("bevat zowel de goal-hash als het URL-patroon", () => {
    const key = makeCacheKey("zoek product", "https://shop.nl/producten");
    expect(key).toContain("|");
    expect(key).toContain("shop.nl/producten");
  });

  it("is identiek voor een URL met en zonder numeriek ID", () => {
    const k1 = makeCacheKey("zoek", "https://shop.nl/product/123");
    const k2 = makeCacheKey("zoek", "https://shop.nl/product/456");
    expect(k1).toBe(k2);
  });
});

// ── CacheStore ────────────────────────────────────────────────────────────────

describe("CacheStore.get/set", () => {
  it("geeft undefined terug als de sleutel niet bestaat", () => {
    const store = tempStore();
    expect(store.get("onbekend")).toBeUndefined();
  });

  it("geeft een opgeslagen entry terug", () => {
    const store = tempStore();
    store.set({ key: "k1", goalPreview: "test", urlPattern: "shop.nl", actions: ACTIONS, savedAt: 1_000_000, totalRuns: 1 });
    const entry = store.get("k1");
    expect(entry).toBeDefined();
    expect(entry!.actions).toHaveLength(3);
    expect(entry!.hitCount).toBe(0);
  });

  it("overschrijft een bestaande entry", () => {
    const store = tempStore();
    store.set({ key: "k1", goalPreview: "oud", urlPattern: "shop.nl", actions: ACTIONS, savedAt: 1_000_000, totalRuns: 1 });
    store.set({ key: "k1", goalPreview: "nieuw", urlPattern: "shop.nl", actions: [], savedAt: 1_000_000, totalRuns: 2 });
    expect(store.get("k1")!.goalPreview).toBe("nieuw");
  });
});

describe("CacheStore TTL", () => {
  it("geeft undefined terug na het verstrijken van de TTL", () => {
    const savedAt = 1_000_000;
    const now = () => savedAt + TTL_MS + 1;
    const store = tempStore(() => savedAt); // schrijf met savedAt
    // Maak een nieuwe store met de verlopen klok om te lezen
    const dir = mkdtempSync(join(tmpdir(), "yad-cache-"));
    const writeStore = new CacheStore(dir, () => savedAt);
    writeStore.set({ key: "k1", goalPreview: "test", urlPattern: "p", actions: ACTIONS, savedAt, totalRuns: 1 });
    const readStore = new CacheStore(dir, now);
    expect(readStore.get("k1")).toBeUndefined();
  });

  it("geeft een entry terug die nog binnen de TTL valt", () => {
    const savedAt = 1_000_000;
    const dir = mkdtempSync(join(tmpdir(), "yad-cache-"));
    const writeStore = new CacheStore(dir, () => savedAt);
    writeStore.set({ key: "k1", goalPreview: "test", urlPattern: "p", actions: ACTIONS, savedAt, totalRuns: 1 });
    const readStore = new CacheStore(dir, () => savedAt + 1000);
    expect(readStore.get("k1")).toBeDefined();
  });
});

describe("CacheStore.hit", () => {
  it("verhoogt hitCount en zet lastHitAt", () => {
    const t = 2_000_000;
    const store = tempStore(() => t);
    store.set({ key: "k1", goalPreview: "test", urlPattern: "p", actions: ACTIONS, savedAt: t, totalRuns: 1 });
    store.hit("k1");
    const entry = store.get("k1")!;
    expect(entry.hitCount).toBe(1);
    expect(entry.lastHitAt).toBe(t);
  });

  it("doet niets voor een onbekende sleutel", () => {
    const store = tempStore();
    expect(() => store.hit("onbekend")).not.toThrow();
  });
});

describe("CacheStore.evictExpired", () => {
  it("verwijdert verlopen entries en geeft het aantal terug", () => {
    const dir = mkdtempSync(join(tmpdir(), "yad-cache-"));
    const old = 1_000_000;
    const fresh = old + TTL_MS - 1000;
    const writeStore = new CacheStore(dir, () => old);
    writeStore.set({ key: "oud", goalPreview: "oud", urlPattern: "p", actions: [], savedAt: old, totalRuns: 1 });
    const writeStore2 = new CacheStore(dir, () => fresh);
    writeStore2.set({ key: "vers", goalPreview: "vers", urlPattern: "p", actions: [], savedAt: fresh, totalRuns: 1 });
    const readStore = new CacheStore(dir, () => old + TTL_MS + 1);
    const removed = readStore.evictExpired();
    expect(removed).toBe(1);
    expect(readStore.get("oud")).toBeUndefined();  // oud is weg
    expect(readStore.get("vers")).toBeDefined();   // vers is nog geldig
  });

  it("geeft 0 terug als er niets verlopen is", () => {
    const store = tempStore();
    store.set({ key: "k1", goalPreview: "test", urlPattern: "p", actions: [], savedAt: 1_000_000, totalRuns: 1 });
    expect(store.evictExpired()).toBe(0);
  });
});
