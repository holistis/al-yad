import { describe, it, expect } from "vitest";
import { buildPool, buildCheapPool } from "./pool.js";

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

  it("SambaNova, DeepSeek, Qwen DashScope en Ollama Cloud doen mee bij een sleutel", () => {
    // Regressietest: deze vier stonden ooit alleen hand-gepatcht in dist/, niet in src/,
    // en verdwenen stilletjes bij de volgende `npm run build`. Nu in de bron zelf.
    const pool = buildPool({
      SAMBANOVA_API_KEY: "a",
      DEEPSEEK_API_KEY: "b",
      QWEN_API_KEY: "c",
      OLLAMA_CLOUD_API_KEY: "d",
    });
    expect(pool.some((p) => p.name === "sambanova")).toBe(true);
    expect(pool.some((p) => p.name === "deepseek")).toBe(true);
    expect(pool.some((p) => p.name === "qwen-dashscope")).toBe(true);
    expect(pool.some((p) => p.name === "ollama-cloud")).toBe(true);
  });

  it("Cloudflare Workers AI doet mee zodra zowel de sleutel als het account-ID gezet zijn", () => {
    const pool = buildPool({ CLOUDFLARE_API_KEY: "t", CLOUDFLARE_ACCOUNT_ID: "acc123" });
    const cf = pool.find((p) => p.name === "cloudflare-workers-ai");
    expect(cf).toBeDefined();
  });

  it("Cloudflare Workers AI doet NIET mee zonder account-ID (baseUrl zou anders ongeldig zijn)", () => {
    const pool = buildPool({ CLOUDFLARE_API_KEY: "t" });
    expect(pool.some((p) => p.name === "cloudflare-workers-ai")).toBe(false);
  });
});

describe("buildCheapPool — klein lokaal model eerst voor Judge/predicaat-werk", () => {
  it("het kleine ollama-cheap-model staat vóór alle cloud-providers", () => {
    const pool = buildCheapPool({ GROQ_API_KEY: "x", GEMINI_API_KEY: "y" });
    const cheap = pool.find((p) => p.name === "ollama-cheap");
    expect(cheap).toBeDefined();
    expect(cheap?.tier).toBeLessThan(pool.find((p) => p.name === "groq")!.tier);
    expect(cheap?.tier).toBeLessThan(pool.find((p) => p.name === "gemini")!.tier);
  });

  it("negeert YAD_PRIMARY_PROVIDER — dat is een keuze voor het hoofd-plan, niet voor cheap-werk", () => {
    const pool = buildCheapPool({ GROQ_API_KEY: "x", YAD_PRIMARY_PROVIDER: "groq" });
    // groq zou in buildPool() tier -1 krijgen door de primary-voorkeur; hier niet.
    expect(pool.find((p) => p.name === "groq")?.tier).toBe(0);
    // het cheap-model blijft alsnog vóór groq, ongeacht de (genegeerde) primary-voorkeur.
    expect(pool.find((p) => p.name === "ollama-cheap")!.tier).toBeLessThan(0);
  });

  it("cloud-providers uit buildPool() zitten ook in de cheap-pool als vangnet", () => {
    const pool = buildCheapPool({ SAMBANOVA_API_KEY: "a", CLOUDFLARE_API_KEY: "t", CLOUDFLARE_ACCOUNT_ID: "acc" });
    expect(pool.some((p) => p.name === "sambanova")).toBe(true);
    expect(pool.some((p) => p.name === "cloudflare-workers-ai")).toBe(true);
  });

  it("de grotere lokale ollama-bodem (tier 2) zit er ook in als allerlaatste vangnet", () => {
    const pool = buildCheapPool({});
    expect(pool.find((p) => p.name === "ollama")?.tier).toBe(2);
  });

  it("respecteert YAD_LOKAAL net zo streng als buildPool() — geen cloud-providers in lokale stand", () => {
    const pool = buildCheapPool({ YAD_LOKAAL: "1", GROQ_API_KEY: "x", OLLAMA_BASE_URL: "http://localhost:11434/v1" });
    expect(pool.every((p) => p.name === "ollama")).toBe(true);
  });
});
