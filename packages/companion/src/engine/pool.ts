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
  ALLOW_PAID_GEMINI?: string;
  YAD_PAID_API_KEY?: string;
  YAD_PAID_BASE_URL?: string;
  YAD_PAID_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
  GROQ_MODEL?: string;
  CEREBRAS_MODEL?: string;
  GEMINI_MODEL?: string;
  OPENROUTER_MODEL?: string;
  GITHUB_MODELS_MODEL?: string;
  GITHUB_MODELS_URL?: string;
  [key: string]: string | undefined;
}

/**
 * Bouwt de geordende provider-pool uit de omgeving. Eén eerlijk account per
 * provider (geen account-farming). Tier 0 = gratis-cloud, 1 = betaald-waar-het-telt,
 * 2 = Ollama als bodemloze lokale terugval. Ollama zit er altijd in als bodem.
 */
export function buildPool(env: PoolEnv = process.env as PoolEnv): LlmProvider[] {
  const providers: LlmProvider[] = [];

  if (env.GROQ_API_KEY) {
    providers.push(
      new OpenAICompatibleProvider({
        name: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: env.GROQ_API_KEY,
        model: env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
        tier: 0,
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
        tier: 0,
      }),
    );
  }
  // Gemini met sleutel-rotatie: elke sleutel is een eigen provider, dus de router
  // schakelt automatisch door bij quota/429. Halal-discipline (gespiegeld van
  // REDACTED): KEY + KEY_2 zijn GRATIS; KEY_3..9 zijn BETAALD en doen
  // alleen mee als ALLOW_PAID_GEMINI=true — zo kan een betaalde sleutel nooit
  // ongemerkt kosten maken.
  const geminiModel = env.GEMINI_MODEL ?? "gemini-2.0-flash";
  const geminiKeys: Array<{ key: string; name: string }> = [];
  if (env.GEMINI_API_KEY) geminiKeys.push({ key: env.GEMINI_API_KEY, name: "gemini" });
  if (env.GEMINI_API_KEY_2) geminiKeys.push({ key: env.GEMINI_API_KEY_2, name: "gemini2" });
  if ((env.ALLOW_PAID_GEMINI ?? "").toLowerCase() === "true") {
    for (let i = 3; i <= 9; i++) {
      const k = env[`GEMINI_API_KEY_${i}`];
      if (k) geminiKeys.push({ key: k, name: `gemini${i}` });
    }
  }
  for (const g of geminiKeys) {
    providers.push(
      new OpenAICompatibleProvider({
        name: g.name,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: g.key,
        model: geminiModel,
        tier: 0,
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
        tier: 0,
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
        tier: 0,
      }),
    );
  }
  if (env.YAD_PAID_API_KEY) {
    providers.push(
      new OpenAICompatibleProvider({
        name: "paid",
        baseUrl: env.YAD_PAID_BASE_URL ?? "https://openrouter.ai/api/v1",
        apiKey: env.YAD_PAID_API_KEY,
        model: env.YAD_PAID_MODEL ?? "anthropic/claude-3.5-sonnet",
        tier: 1,
      }),
    );
  }

  // Ollama als bodem (alleen nuttig als lokaal geinstalleerd, maar nooit "op").
  providers.push(
    new OpenAICompatibleProvider({
      name: "ollama",
      baseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      model: env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct",
      tier: 2,
    }),
  );

  return providers;
}
