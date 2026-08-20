import type { YadSettings, YadWorkflow, YadHistoryEntry, SiteOverrides, ProviderUserConfig } from "@yad/shared";
import { DEFAULT_SETTINGS, DEFAULT_PROVIDER_CONFIGS } from "@yad/shared";

const KEY_SETTINGS = "yad:settings";
const KEY_WORKFLOWS = "yad:workflows";
const KEY_HISTORY = "yad:history";
const KEY_SITE_OVERRIDES = "yad:site-overrides";
const MAX_HISTORY = 20;

// ---- Settings (met migratie van oud plat formaat) ----

interface LegacySettings {
  groqKey?: string;
  geminiKey?: string;
  geminiKey2?: string;
  openrouterKey?: string;
  githubToken?: string;
  paidKey?: string;
  paidBaseUrl?: string;
  paidModel?: string;
  paidPrimary?: boolean;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  maxSteps?: number;
}

function isLegacy(s: unknown): s is LegacySettings {
  return typeof s === "object" && s !== null && "groqKey" in s;
}

function migrateLegacy(old: LegacySettings): YadSettings {
  const p: Record<string, ProviderUserConfig> = JSON.parse(JSON.stringify(DEFAULT_PROVIDER_CONFIGS)) as Record<string, ProviderUserConfig>;
  if (old.groqKey) p.groq = { enabled: true, key: old.groqKey };
  if (old.geminiKey) p.gemini = { enabled: true, key: old.geminiKey };
  if (old.geminiKey2) p.gemini2 = { enabled: true, key: old.geminiKey2 };
  if (old.openrouterKey) p.openrouter = { enabled: true, key: old.openrouterKey };
  if (old.githubToken) p.github = { enabled: true, key: old.githubToken };
  if (old.paidKey) {
    p.paid = {
      enabled: true,
      key: old.paidKey,
      baseUrl: old.paidBaseUrl ?? p.paid?.baseUrl,
      model: old.paidModel ?? p.paid?.model,
      primary: old.paidPrimary ?? false,
    };
  }
  if (old.ollamaBaseUrl ?? old.ollamaModel) {
    p.ollama = {
      ...p.ollama,
      enabled: true,
      baseUrl: old.ollamaBaseUrl ?? p.ollama?.baseUrl,
      model: old.ollamaModel ?? p.ollama?.model,
    };
  }
  return { providers: p, maxSteps: old.maxSteps ?? DEFAULT_SETTINGS.maxSteps, autonomy: DEFAULT_SETTINGS.autonomy, language: DEFAULT_SETTINGS.language };
}

/**
 * Taal bij een nieuwe gebruiker: volg de taal van de browser. Nederlandse browser -> nl,
 * al het andere -> en (Engels is de internationale standaard). Een eigen keuze van de
 * gebruiker (opgeslagen) wint altijd; dit geldt alleen zolang er nog niets is opgeslagen.
 */
function detectBrowserLang(): "nl" | "en" {
  try {
    const ui = (chrome.i18n?.getUILanguage?.() ?? "").toLowerCase();
    return ui.startsWith("nl") ? "nl" : "en";
  } catch {
    return "en";
  }
}

export async function getSettings(): Promise<YadSettings> {
  const res = await chrome.storage.local.get(KEY_SETTINGS);
  const stored = res[KEY_SETTINGS] as unknown;
  if (isLegacy(stored)) {
    const migrated = migrateLegacy(stored);
    await saveSettings(migrated);
    return migrated;
  }
  const typed = stored as Partial<YadSettings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...(typed ?? {}),
    language: (typed?.language as "nl" | "en" | undefined) ?? detectBrowserLang(),
    providers: { ...DEFAULT_PROVIDER_CONFIGS, ...(typed?.providers ?? {}) },
  };
}

export async function saveSettings(s: YadSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY_SETTINGS]: s });
}

// ---- Workflows ----

export async function getWorkflows(): Promise<YadWorkflow[]> {
  const res = await chrome.storage.local.get(KEY_WORKFLOWS);
  return (res[KEY_WORKFLOWS] as YadWorkflow[] | undefined) ?? [];
}

export async function saveWorkflows(workflows: YadWorkflow[]): Promise<void> {
  await chrome.storage.local.set({ [KEY_WORKFLOWS]: workflows });
}

export async function addWorkflow(name: string, goal: string): Promise<YadWorkflow> {
  const workflows = await getWorkflows();
  const entry: YadWorkflow = {
    id: crypto.randomUUID(),
    name,
    goal,
    createdAt: Date.now(),
  };
  await saveWorkflows([entry, ...workflows]);
  return entry;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const workflows = await getWorkflows();
  await saveWorkflows(workflows.filter((w) => w.id !== id));
}

// ---- History ----

export async function getHistory(): Promise<YadHistoryEntry[]> {
  const res = await chrome.storage.local.get(KEY_HISTORY);
  return (res[KEY_HISTORY] as YadHistoryEntry[] | undefined) ?? [];
}

export async function addHistoryEntry(entry: YadHistoryEntry): Promise<void> {
  const history = await getHistory();
  const updated = [entry, ...history].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ [KEY_HISTORY]: updated });
}

// ---- Site overrides ----

export async function getSiteOverrides(): Promise<SiteOverrides> {
  const res = await chrome.storage.local.get(KEY_SITE_OVERRIDES);
  return (res[KEY_SITE_OVERRIDES] as SiteOverrides | undefined) ?? {};
}

export async function setSiteOverride(
  hostname: string,
  tier: "stealth" | "normal" | "fast" | null,
): Promise<void> {
  const overrides = await getSiteOverrides();
  if (tier === null) {
    delete overrides[hostname];
  } else {
    overrides[hostname] = tier;
  }
  await chrome.storage.local.set({ [KEY_SITE_OVERRIDES]: overrides });
}
