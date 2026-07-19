import process from "node:process";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import type { LlmProvider } from "./types.js";

export interface PoolEnv {
  GROQ_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY_2?: string;
  OPENROUTER_API_KEY?: string;
  GITHUB_TOKEN?: string;
  TOGETHER_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  HYPERBOLIC_API_KEY?: string;
  ALLOW_PAID_GEMINI?: string;
  YAD_PAID_API_KEY?: string;
  YAD_PAID_BASE_URL?: string;
  YAD_PAID_MODEL?: string;
  YAD_PAID_PRIMARY?: string;
  YAD_PRIMARY_PROVIDER?: string;
  YAD_CUSTOM_API_KEY?: string;
  YAD_CUSTOM_BASE_URL?: string;
  YAD_CUSTOM_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
  OLLAMA_API_KEY?: string;
  GROQ_MODEL?: string;
  CEREBRAS_MODEL?: string;
  GEMINI_MODEL?: string;
  OPENROUTER_MODEL?: string;
  GITHUB_MODELS_MODEL?: string;
  GITHUB_MODELS_URL?: string;
  TOGETHER_MODEL?: string;
  MISTRAL_MODEL?: string;
  HYPERBOLIC_MODEL?: string;
  [key: string]: string | undefined;
}

/**
 * Bouwt de geordende provider-pool uit de omgeving. Eén eerlijk account per
 * provider (geen account-farming). Tier 0 = gratis-cloud, 1 = betaald-waar-het-telt,
 * 2 = Ollama als bodemloze lokale terugval. Ollama zit er altijd in als bodem.
 */
export function buildPool(env: PoolEnv = process.env as PoolEnv): LlmProvider[] {
  const providers: LlmProvider[] = [];

  // Welke provider is door de gebruiker als 'sterkste, altijd eerst' gemarkeerd?
  // Die krijgt tier -1 (vóór de gratis pool). Backward-compat: YAD_PAID_PRIMARY.
  const paidPrimary = (env.YAD_PAID_PRIMARY ?? "").toLowerCase() === "true";
  const primaryName = env.YAD_PRIMARY_PROVIDER || (paidPrimary ? "paid" : "");
  const tierFor = (name: string, base: number): number =>
    primaryName && name === primaryName ? -1 : base;

  // Gemini staat EERST in de pool (laagste insertie-index binnen tier 0) zodat
  // KEY_3 → KEY_4 → KEY_1 → KEY_2 worden geprobeerd vóór Groq/Cerebras.
  // Halal-discipline: KEY + KEY_2 zijn gratis (AI Studio); KEY_3..9 zijn uit een
  // betaald GCP-project en doen mee als ALLOW_PAID_GEMINI=true (settingsToEnv
  // zet dat automatisch als de gebruiker ze inschakelt in het paneel).
  const geminiModel = env.GEMINI_MODEL ?? "gemini-2.0-flash";
  const geminiKeys: Array<{ key: string; name: string }> = [];
  if ((env.ALLOW_PAID_GEMINI ?? "").toLowerCase() === "true") {
    // Betaalde sleutels gaan EERST (de gebruiker koos ze bewust als primair)
    for (let i = 3; i <= 9; i++) {
      const k = env[`GEMINI_API_KEY_${i}`];
      if (k) geminiKeys.push({ key: k, name: `gemini${i}` });
    }
  }
  if (env.GEMINI_API_KEY) geminiKeys.push({ key: env.GEMINI_API_KEY, name: "gemini" });
  if (env.GEMINI_API_KEY_2) geminiKeys.push({ key: env.GEMINI_API_KEY_2, name: "gemini2" });
  for (const g of geminiKeys) {
    providers.push(
      new OpenAICompatibleProvider({
        name: g.name,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: g.key,
        model: geminiModel,
        tier: tierFor(g.name, 0),
      }),
    );
  }

  if (env.GROQ_API_KEY) {
    providers.push(
      new OpenAICompatibleProvider({
        name: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: env.GROQ_API_KEY,
        model: env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
        tier: tierFor("groq", 0),
      }),
    );
  }
  if (env.CEREBRAS_API_KEY) {
    providers.push(
      new OpenAICompatibleProvider({
        name: "cerebras",
        baseUrl: "https://api.cerebras.ai/v1",
        apiKey: env.CEREBRAS_API_KEY,
        model: env.CEREBRAS_MODEL ?? "llama3.1-8b",
        tier: tierFor("cerebras", 0),
      }),
    );
  }
  if (env.OPENROUTER_API_KEY) {
    providers.push(
      new OpenAICompatibleProvider({
        name: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: env.OPENROUTER_API_KEY,
        model: env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free",
        tier: tierFor("openrouter", 0),
      }),
    );
  }
  // GitHub Models: aparte gratis pool voor GitHub-gebruikers (OpenAI-compatibel,
  // auth met GITHUB_TOKEN). Geeft extra ademruimte als de andere tier-0 vol zitten.
  if (env.GITHUB_TOKEN) {
    providers.push(
      new OpenAICompatibleProvider({
        name: "github-models",
        baseUrl: (env.GITHUB_MODELS_URL ?? "https://models.github.ai/inference").replace(/\/+$/, ""),
        apiKey: env.GITHUB_TOKEN,
        model: env.GITHUB_MODELS_MODEL ?? "openai/gpt-4o-mini",
        tier: tierFor("github-models", 0),
      }),
    );
  }
  if (env.TOGETHER_API_KEY) {
    providers.push(
      new OpenAICompatibleProvider({
        name: "together",
        baseUrl: "https://api.together.xyz/v1",
        apiKey: env.TOGETHER_API_KEY,
        model: env.TOGETHER_MODEL ?? "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
        tier: tierFor("together", 0),
      }),
    );
  }
  if (env.MISTRAL_API_KEY) {
    providers.push(
      new OpenAICompatibleProvider({
        name: "mistral",
        baseUrl: "https://api.mistral.ai/v1",
        apiKey: env.MISTRAL_API_KEY,
        model: env.MISTRAL_MODEL ?? "open-mistral-nemo",
        tier: tierFor("mistral", 0),
      }),
    );
  }
  if (env.HYPERBOLIC_API_KEY) {
    providers.push(
      new OpenAICompatibleProvider({
        name: "hyperbolic",
        baseUrl: "https://api.hyperbolic.xyz/v1",
        apiKey: env.HYPERBOLIC_API_KEY,
        model: env.HYPERBOLIC_MODEL ?? "meta-llama/Llama-3.3-70B-Instruct",
        tier: tierFor("hyperbolic", 0),
      }),
    );
  }
  // Eigen / andere provider: elke OpenAI-compatibele API (door de gebruiker
  // ingevoerd). Alleen http/https als doel (geen file:/localhost-only-eis, want
  // het kan een eigen LAN-endpoint zijn). Halal/veilig: dit is de eigen sleutel
  // van de gebruiker op de eigen machine (BYOK).
  if (env.YAD_CUSTOM_API_KEY && env.YAD_CUSTOM_BASE_URL && /^https?:\/\//i.test(env.YAD_CUSTOM_BASE_URL)) {
    providers.push(
      new OpenAICompatibleProvider({
        name: "custom",
        baseUrl: env.YAD_CUSTOM_BASE_URL,
        apiKey: env.YAD_CUSTOM_API_KEY,
        model: env.YAD_CUSTOM_MODEL ?? "gpt-4o-mini",
        tier: tierFor("custom", 0),
      }),
    );
  }
  if (env.YAD_PAID_API_KEY) {
    // Primair (tier -1) als de gebruiker 'altijd eerst' koos: beste kwaliteit op
    // lastige sites, je betaalt per stap. Anders tier 1: vangnet, alleen als de
    // gratis pool faalt (goedkoopst).
    providers.push(
      new OpenAICompatibleProvider({
        name: "paid",
        baseUrl: env.YAD_PAID_BASE_URL ?? "https://openrouter.ai/api/v1",
        apiKey: env.YAD_PAID_API_KEY,
        model: env.YAD_PAID_MODEL ?? "anthropic/claude-3.5-sonnet",
        tier: tierFor("paid", 1),
      }),
    );
  }

  // Ollama als bodem (alleen nuttig als lokaal geinstalleerd, maar nooit "op").
  providers.push(
    new OpenAICompatibleProvider({
      name: "ollama",
      baseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      model: env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct",
      apiKey: env.OLLAMA_API_KEY,
      tier: 2,
    }),
  );

  return providers;
}

/**
 * Losse, Ollama-ONLY pool voor extern/klant-verkeer (YAD_EXTERNAL_MODE). Bewust
 * gescheiden van buildPool(): externe opdrachten mogen NOOIT de eigen gratis/betaalde
 * sleutels van de koning aanspreken (Groq/Gemini/etc. blijven privé). Gebruikt een
 * eigen model-env (YAD_EXTERNAL_OLLAMA_MODEL) zodat de koning's eigen OLLAMA_MODEL
 * (bodem-terugval, kan een zwaarder model zijn) hier niet door wordt beïnvloed.
 * Benchmark 2026-07-19 op i7-6700/32GB CPU-only: qwen2.5:32b ~85-105s/stap (te traag
 * voor interactieve runs), qwen2.5:7b ~13-27s/stap (bruikbaar) — vandaar de 7b-default.
 * Geeft een LEGE array terug als Ollama niet geconfigureerd is (geen stille fallback).
 */
export function buildExternalOllamaPool(env: PoolEnv = process.env as PoolEnv): LlmProvider[] {
  if (!env.OLLAMA_BASE_URL) return [];
  return [
    new OpenAICompatibleProvider({
      name: "ollama-external",
      baseUrl: env.OLLAMA_BASE_URL,
      model: env["YAD_EXTERNAL_OLLAMA_MODEL"] ?? "qwen2.5:7b",
      apiKey: env.OLLAMA_API_KEY,
      tier: 0,
    }),
  ];
}
