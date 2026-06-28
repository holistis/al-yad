/**
 * Live-demo van de Motor: bouwt de provider-pool uit je omgeving en laat zien
 * welke provider het antwoord levert (de failover in actie). Werkt met elke
 * sleutel die in je omgeving of in .env staat; zonder sleutels valt hij terug
 * op Ollama (alleen als dat lokaal draait).
 *
 * Draai: pnpm engine-smoke
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { buildPool } from "../packages/companion/src/engine/pool.js";
import { LlmRouter } from "../packages/companion/src/engine/router.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// minimale .env-lader (overschrijft bestaande env niet)
function loadEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const val = (m[2] ?? "").replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnv(resolve(repoRoot, ".env"));

const providers = buildPool();
const router = new LlmRouter(providers, { log: (m) => console.error("  [router]", m) });

console.log("Geconfigureerde providers (tier-volgorde):");
for (const p of [...providers].sort((a, b) => a.tier - b.tier)) {
  console.log(`  tier ${p.tier}  ${p.name}  (${p.model})`);
}
console.log("");

try {
  const res = await router.chat({
    messages: [
      { role: "system", content: "Je antwoordt extreem kort." },
      { role: "user", content: "Antwoord met precies deze drie woorden: Yad leeft nu." },
    ],
    temperature: 0,
    maxTokens: 32,
  });
  console.log(`ANTWOORD van provider "${res.provider}" (model ${res.model}):`);
  console.log(`  ${res.content.trim()}`);
  console.log(`  geprobeerd: [${res.attempts.join(", ")}]`);
} catch (err) {
  console.error("Geen enkele provider leverde een antwoord:");
  console.error("  " + (err as Error).message);
  console.error("Tip: zet een sleutel in .env (bv. GEMINI_API_KEY of GROQ_API_KEY) of start Ollama.");
  process.exit(1);
}
