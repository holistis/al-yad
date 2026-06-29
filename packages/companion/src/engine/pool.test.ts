import { describe, it, expect } from "vitest";
import { buildPool } from "./pool.js";

describe("buildPool — primary (sterkste eerst)", () => {
  it("zonder primary krijgt een gratis provider tier 0", () => {
    const pool = buildPool({ GROQ_API_KEY: "x" });
    expect(pool.find((p) => p.name === "groq")?.tier).toBe(0);
  });

  it("YAD_PRIMARY_PROVIDER bumpt de gekozen provider naar tier -1 (vóór de gratis pool)", () => {
    const pool = buildPool({ GROQ_API_KEY: "x", GEMINI_API_KEY: "y", YAD_PRIMARY_PROVIDER: "gemini" });
    expect(pool.find((p) => p.name === "gemini")?.tier).toBe(-1);
    expect(pool.find((p) => p.name === "groq")?.tier).toBe(0);
  });

  it("YAD_PAID_PRIMARY=true blijft werken (backward-compat met .env)", () => {
    const pool = buildPool({ YAD_PAID_API_KEY: "p", YAD_PAID_PRIMARY: "true" });
    expect(pool.find((p) => p.name === "paid")?.tier).toBe(-1);
  });

  it("paid zonder primary is een vangnet op tier 1", () => {
    const pool = buildPool({ GROQ_API_KEY: "x", YAD_PAID_API_KEY: "p" });
    expect(pool.find((p) => p.name === "paid")?.tier).toBe(1);
  });

  it("eigen provider (custom) komt in de pool bij een geldige http-baseUrl", () => {
    const pool = buildPool({ YAD_CUSTOM_API_KEY: "k", YAD_CUSTOM_BASE_URL: "https://api.example.com/v1" });
    expect(pool.some((p) => p.name === "custom")).toBe(true);
  });

  it("eigen provider wordt geweigerd bij een niet-http baseUrl (exposure-poort)", () => {
    const pool = buildPool({ YAD_CUSTOM_API_KEY: "k", YAD_CUSTOM_BASE_URL: "file:///etc/passwd" });
    expect(pool.some((p) => p.name === "custom")).toBe(false);
  });

  it("Together AI, Mistral en Hyperbolic doen mee bij een sleutel", () => {
    const pool = buildPool({ TOGETHER_API_KEY: "a", MISTRAL_API_KEY: "b", HYPERBOLIC_API_KEY: "c" });
    expect(pool.some((p) => p.name === "together")).toBe(true);
    expect(pool.some((p) => p.name === "mistral")).toBe(true);
    expect(pool.some((p) => p.name === "hyperbolic")).toBe(true);
  });

  it("Ollama zit er altijd in als bodem (tier 2)", () => {
    const pool = buildPool({});
    expect(pool.find((p) => p.name === "ollama")?.tier).toBe(2);
  });
});
