/** Configuratie van één provider door de gebruiker. */
export interface ProviderUserConfig {
  enabled: boolean;
  key: string;
  model?: string;
  baseUrl?: string;
  /** deze provider als sterkste EERST proberen (tier -1 in de pool) */
  primary?: boolean;
  /**
   * true = `key` is GEEN kale sleutel meer maar een DPAPI-versleutelde blob van de companion
   * (alleen op deze Windows-machine te ontsleutelen). Zo bewaart de extensie nooit een
   * leesbare sleutel op schijf. false/ontbrekend = `key` is (nog) platte tekst, bv. net
   * geplakt door de gebruiker of op een niet-Windows dev-machine.
   */
  encrypted?: boolean;
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
  /** Uitgaven-poort: max AI-aanroepen per dag (dag-limiet). */
  maxRequestsPerDay?: number;
  /** Noodstop: als true blokkeert de companion elke AI-aanroep tot dit weer uit staat. */
  killed?: boolean;
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
  maxRequestsPerDay: 1000,
  killed: false,
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

/** Env-var-naam -> catalogus-provider-id, voor het terugmappen van encKeys naar de UI. */
export const ENV_KEY_TO_PROVIDER: Record<string, string> = {
  GROQ_API_KEY: "groq",
  CEREBRAS_API_KEY: "cerebras",
  GEMINI_API_KEY: "gemini",
  GEMINI_API_KEY_2: "gemini2",
  GEMINI_API_KEY_3: "gemini3",
  GEMINI_API_KEY_4: "gemini4",
  OPENROUTER_API_KEY: "openrouter",
  GITHUB_TOKEN: "github",
  TOGETHER_API_KEY: "together",
  MISTRAL_API_KEY: "mistral",
  HYPERBOLIC_API_KEY: "hyperbolic",
  YAD_PAID_API_KEY: "paid",
  YAD_CUSTOM_API_KEY: "custom",
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

/** Env-variabelen voor de companion, gesplitst naar of de sleutel-waarde al versleuteld is. */
export interface SettingsEnv {
  /** Nog platte sleutels (net geplakt, of niet-Windows) — de companion versleutelt ze. */
  env: Record<string, string>;
  /** Al DPAPI-versleutelde blobs (companion ontsleutelt ze, bewaart NOOIT plat). */
  encEnv: Record<string, string>;
}

/**
 * Converteert UI-instellingen naar env-variabelen voor de companion, gesplitst in plat
 * (env) en versleuteld (encEnv) op basis van elke provider's `encrypted`-vlag. Niet-sleutel
 * instellingen (model, baseUrl, taal, primary) gaan altijd via `env`, nooit versleuteld.
 */
export function settingsToEnv(s: YadSettings): SettingsEnv {
  const env: Record<string, string> = {};
  const encEnv: Record<string, string> = {};
  const p = s.providers;

  /** Zet de sleutel in env of encEnv, afhankelijk van cfg.encrypted. Overige velden altijd in env. */
  const setKey = (cfg: ProviderUserConfig, name: string): void => {
    if (cfg.encrypted) encEnv[name] = cfg.key;
    else env[name] = cfg.key;
  };

  if (p.groq?.enabled && p.groq.key) {
    setKey(p.groq, "GROQ_API_KEY");
    if (p.groq.model) env["GROQ_MODEL"] = p.groq.model;
  }
  if (p.cerebras?.enabled && p.cerebras.key) {
    setKey(p.cerebras, "CEREBRAS_API_KEY");
    if (p.cerebras.model) env["CEREBRAS_MODEL"] = p.cerebras.model;
  }
  if (p.gemini?.enabled && p.gemini.key) setKey(p.gemini, "GEMINI_API_KEY");
  if (p.gemini2?.enabled && p.gemini2.key) setKey(p.gemini2, "GEMINI_API_KEY_2");
  if (p.gemini3?.enabled && p.gemini3.key) setKey(p.gemini3, "GEMINI_API_KEY_3");
  if (p.gemini4?.enabled && p.gemini4.key) setKey(p.gemini4, "GEMINI_API_KEY_4");
  // Als KEY_3 of KEY_4 actief zijn, geeft de gebruiker expliciet toestemming
  // voor gebruik van sleutels uit een betaald GCP-project (gratis dagquota).
  if ((p.gemini3?.enabled && p.gemini3.key) || (p.gemini4?.enabled && p.gemini4.key)) {
    env["ALLOW_PAID_GEMINI"] = "true";
  }
  // alle Gemini-sleutels delen één model-instelling in de pool
  if (p.gemini?.model) env["GEMINI_MODEL"] = p.gemini.model;
  else if (p.gemini2?.model) env["GEMINI_MODEL"] = p.gemini2.model;
  if (p.openrouter?.enabled && p.openrouter.key) {
    setKey(p.openrouter, "OPENROUTER_API_KEY");
    if (p.openrouter.model) env["OPENROUTER_MODEL"] = p.openrouter.model;
  }
  if (p.github?.enabled && p.github.key) {
    setKey(p.github, "GITHUB_TOKEN");
    if (p.github.model) env["GITHUB_MODELS_MODEL"] = p.github.model;
  }
  if (p.together?.enabled && p.together.key) {
    setKey(p.together, "TOGETHER_API_KEY");
    if (p.together.model) env["TOGETHER_MODEL"] = p.together.model;
  }
  if (p.mistral?.enabled && p.mistral.key) {
    setKey(p.mistral, "MISTRAL_API_KEY");
    if (p.mistral.model) env["MISTRAL_MODEL"] = p.mistral.model;
  }
  if (p.hyperbolic?.enabled && p.hyperbolic.key) {
    setKey(p.hyperbolic, "HYPERBOLIC_API_KEY");
    if (p.hyperbolic.model) env["HYPERBOLIC_MODEL"] = p.hyperbolic.model;
  }
  if (p.paid?.enabled && p.paid.key) {
    setKey(p.paid, "YAD_PAID_API_KEY");
    if (p.paid.baseUrl) env["YAD_PAID_BASE_URL"] = p.paid.baseUrl;
    if (p.paid.model) env["YAD_PAID_MODEL"] = p.paid.model;
  }
  if (p.custom?.enabled && p.custom.key && p.custom.baseUrl) {
    setKey(p.custom, "YAD_CUSTOM_API_KEY");
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

  return { env, encEnv };
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
