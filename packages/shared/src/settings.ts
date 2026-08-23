/** Configuratie van één provider door de gebruiker. */
export interface ProviderUserConfig {
  enabled: boolean;
  key: string;
  model?: string;
  baseUrl?: string;
  /** deze provider als sterkste EERST proberen (tier -1 in de pool) */
  primary?: boolean;
}

/** Hoe zelfstandig Yad mag handelen. */
export type Autonomy = "confirm" | "auto";

/** Taal van de agent-antwoorden. */
export type Language = "nl" | "en";

/** Instellingen die de gebruiker invoert in het zijpaneel. */
export interface YadSettings {
  providers: Record<string, ProviderUserConfig>;
  maxSteps: number;
  /** "confirm" = vraag bij elke wijziging (veilig). "auto" = doe alles zelf. */
  autonomy: Autonomy;
  /** Taal van Yad's antwoorden: "nl" (standaard) of "en". */
  language: Language;
}

export const DEFAULT_PROVIDER_CONFIGS: Record<string, ProviderUserConfig> = {
  groq: { enabled: false, key: "" },
  cerebras: { enabled: false, key: "" },
  gemini: { enabled: false, key: "" },
  gemini2: { enabled: false, key: "" },
  gemini3: { enabled: false, key: "" },
  gemini4: { enabled: false, key: "" },
  openrouter: { enabled: false, key: "" },
  github: { enabled: false, key: "" },
  together: { enabled: false, key: "" },
  mistral: { enabled: false, key: "" },
  hyperbolic: { enabled: false, key: "" },
  paid: { enabled: false, key: "", baseUrl: "https://openrouter.ai/api/v1", primary: false },
  custom: { enabled: false, key: "", baseUrl: "https://api.openai.com/v1" },
  ollama: { enabled: true, key: "", baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b-instruct" },
};

export const DEFAULT_SETTINGS: YadSettings = {
  providers: DEFAULT_PROVIDER_CONFIGS,
  maxSteps: 15,
  autonomy: "confirm",
  language: "nl",
};

/** Catalogus-id → naam waaronder de provider in de companion-pool leeft. */
const POOL_NAME: Record<string, string> = {
  groq: "groq",
  cerebras: "cerebras",
  gemini: "gemini",
  gemini2: "gemini2",
  gemini3: "gemini3",
  gemini4: "gemini4",
  openrouter: "openrouter",
  github: "github-models",
  together: "together",
  mistral: "mistral",
  hyperbolic: "hyperbolic",
  paid: "paid",
  custom: "custom",
  ollama: "ollama",
};

/** Volgorde waarin we naar de 'primary' (sterkste-eerst) provider zoeken. */
const PRIMARY_ORDER = [
  "paid",
  "custom",
  "gemini",
  "gemini2",
  "gemini3",
  "gemini4",
  "groq",
  "cerebras",
  "openrouter",
  "github",
  "together",
  "mistral",
  "hyperbolic",
];

/** Converteert UI-instellingen naar env-variabelen voor de companion. */
export function settingsToEnv(s: YadSettings): Record<string, string> {
  const env: Record<string, string> = {};
  const p = s.providers;

  if (p.groq?.enabled && p.groq.key) {
    env["GROQ_API_KEY"] = p.groq.key;
    if (p.groq.model) env["GROQ_MODEL"] = p.groq.model;
  }
  if (p.cerebras?.enabled && p.cerebras.key) {
    env["CEREBRAS_API_KEY"] = p.cerebras.key;
    if (p.cerebras.model) env["CEREBRAS_MODEL"] = p.cerebras.model;
  }
  if (p.gemini?.enabled && p.gemini.key) env["GEMINI_API_KEY"] = p.gemini.key;
  if (p.gemini2?.enabled && p.gemini2.key) env["GEMINI_API_KEY_2"] = p.gemini2.key;
  if (p.gemini3?.enabled && p.gemini3.key) env["GEMINI_API_KEY_3"] = p.gemini3.key;
  if (p.gemini4?.enabled && p.gemini4.key) env["GEMINI_API_KEY_4"] = p.gemini4.key;
  // Als KEY_3 of KEY_4 actief zijn, geeft de gebruiker expliciet toestemming
  // voor gebruik van sleutels uit een betaald GCP-project (gratis dagquota).
  if ((p.gemini3?.enabled && p.gemini3.key) || (p.gemini4?.enabled && p.gemini4.key)) {
    env["ALLOW_PAID_GEMINI"] = "true";
  }
  // alle Gemini-sleutels delen één model-instelling in de pool
  if (p.gemini?.model) env["GEMINI_MODEL"] = p.gemini.model;
  else if (p.gemini2?.model) env["GEMINI_MODEL"] = p.gemini2.model;
  if (p.openrouter?.enabled && p.openrouter.key) {
    env["OPENROUTER_API_KEY"] = p.openrouter.key;
    if (p.openrouter.model) env["OPENROUTER_MODEL"] = p.openrouter.model;
  }
  if (p.github?.enabled && p.github.key) {
    env["GITHUB_TOKEN"] = p.github.key;
    if (p.github.model) env["GITHUB_MODELS_MODEL"] = p.github.model;
  }
  if (p.together?.enabled && p.together.key) {
    env["TOGETHER_API_KEY"] = p.together.key;
    if (p.together.model) env["TOGETHER_MODEL"] = p.together.model;
  }
  if (p.mistral?.enabled && p.mistral.key) {
    env["MISTRAL_API_KEY"] = p.mistral.key;
    if (p.mistral.model) env["MISTRAL_MODEL"] = p.mistral.model;
  }
  if (p.hyperbolic?.enabled && p.hyperbolic.key) {
    env["HYPERBOLIC_API_KEY"] = p.hyperbolic.key;
    if (p.hyperbolic.model) env["HYPERBOLIC_MODEL"] = p.hyperbolic.model;
  }
  if (p.paid?.enabled && p.paid.key) {
    env["YAD_PAID_API_KEY"] = p.paid.key;
    if (p.paid.baseUrl) env["YAD_PAID_BASE_URL"] = p.paid.baseUrl;
    if (p.paid.model) env["YAD_PAID_MODEL"] = p.paid.model;
  }
  if (p.custom?.enabled && p.custom.key && p.custom.baseUrl) {
    env["YAD_CUSTOM_API_KEY"] = p.custom.key;
    env["YAD_CUSTOM_BASE_URL"] = p.custom.baseUrl;
    if (p.custom.model) env["YAD_CUSTOM_MODEL"] = p.custom.model;
  }
  if (p.ollama?.baseUrl) env["OLLAMA_BASE_URL"] = p.ollama.baseUrl;
  if (p.ollama?.model) env["OLLAMA_MODEL"] = p.ollama.model;

  env["YAD_LANGUAGE"] = s.language ?? "nl";

  // Welke ingeschakelde provider moet als sterkste EERST? (één winnaar)
  for (const id of PRIMARY_ORDER) {
    const cfg = p[id];
    if (cfg?.enabled && cfg.key && cfg.primary) {
      env["YAD_PRIMARY_PROVIDER"] = POOL_NAME[id] ?? id;
      break;
    }
  }

  return env;
}

/** Opgeslagen taak (workflow): één klik om opnieuw te starten. */
export interface YadWorkflow {
  id: string;
  name: string;
  goal: string;
  createdAt: number;
}

/** Eén afgeronde run in de geschiedenis. */
export interface YadHistoryEntry {
  id: string;
  goal: string;
  status: string;
  steps: number;
  summary?: string;
  startedAt: number;
}

/** Site-gedrag overrides: hostname → tier. */
export type SiteOverrides = Record<string, "stealth" | "normal" | "fast">;
