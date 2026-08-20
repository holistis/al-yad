import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";

/**
 * Laadt .env ZONDER externe dependency (licentie-poort: alleen MIT/Apache deps,
 * en dit hoeft er geen van te zijn). Een native-messaging host wordt door Chrome
 * gestart met Chrome's environment; de repo-.env staat daar niet in. We lezen hem
 * dus expliciet in. Bestaande, niet-lege process.env-waarden winnen (echte env > .env).
 *
 * Geeft het geladen pad terug, of null als er geen .env gevonden is.
 */
export function loadEnvFile(explicitPath?: string): string | null {
  const raw: (string | undefined)[] = [explicitPath, process.env["YAD_ENV_FILE"]];
  // Dev (repo): .env relatief aan deze module. import.meta.url is undefined in een
  // CJS-bundel, dus afschermen en die kandidaten overslaan i.p.v. crashen.
  try {
    const url = import.meta.url;
    if (url) {
      const here = dirname(fileURLToPath(url));
      raw.push(resolve(here, "../../../.env")); // dist -> companion -> packages -> al-yad
      raw.push(resolve(here, "../../.env")); // val-back als build-structuur platter is
    }
  } catch {
    /* bundel zonder module-url */
  }
  raw.push(resolve(process.cwd(), ".env"));
  const candidates = raw.filter((p): p is string => typeof p === "string" && p.length > 0);

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      parseInto(readFileSync(path, "utf8"));
      return path;
    } catch {
      /* onleesbaar -> probeer de volgende kandidaat */
    }
  }
  return null;
}

function parseInto(content: string): void {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    // echte env wint: overschrijf nooit een al-gezette, niet-lege waarde.
    const existing = process.env[key];
    if (existing !== undefined && existing !== "") continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
