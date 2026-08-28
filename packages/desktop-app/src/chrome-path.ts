/**
 * resolveBrowserExecutable — vindt een Chrome/Chromium-executable om de
 * UI-schil in app-modus te openen (--app=..., verbergt tabbalk+adresbalk).
 *
 * Volgorde (bewust, zie CLAUDE.md/opdracht — geen dev-only pad als primair):
 *   1. Systeem-Chrome — het pad waar YAD's eigen Chrome-extensie toch al
 *      van afhankelijk is, dus een echte eindgebruiker heeft dit altijd.
 *   2. Systeem-Edge — ook Chromium-based, ondersteunt dezelfde --app-vlag,
 *      en zit standaard op elke Windows-machine.
 *   3. Playwright's eigen gedownloade Chromium onder ms-playwright — ALLEEN
 *      een dev-machine-terugval. Deze map bestaat alleen als hier ooit
 *      `npx playwright install` is gedraaid (zoals op dit ontwikkeltoestel).
 *      Op de machine van een echte gebruiker bestaat hij niet — daarom NOOIT
 *      als primair pad, en met een expliciete log-regel als hij wél gebruikt
 *      wordt zodat het nooit stil verward wordt met "de echte install".
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SYSTEM_CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  join(homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
];

const SYSTEM_EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

// Zoekt onder ms-playwright naar de nieuwste "chromium-<nr>/chrome-win64/chrome.exe". DEV-ONLY terugval.
function findPlaywrightChromiumDevFallback(): string | null {
  const base = join(homedir(), "AppData", "Local", "ms-playwright");
  if (!existsSync(base)) return null;
  try {
    const dirs = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^chromium-\d+$/.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // hoogste build-nr eerst
    for (const dir of dirs) {
      const exe = join(base, dir, "chrome-win64", "chrome.exe");
      if (existsSync(exe)) return exe;
    }
  } catch {
    /* onleesbare map — gewoon geen dev-fallback beschikbaar */
  }
  return null;
}

export function resolveBrowserExecutable(log: (m: string) => void = () => {}): string {
  for (const p of SYSTEM_CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  for (const p of SYSTEM_EDGE_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  const devFallback = findPlaywrightChromiumDevFallback();
  if (devFallback) {
    log(
      `Geen systeem-Chrome/Edge gevonden — val terug op Playwright's eigen Chromium ` +
        `(alleen bedoeld voor dit dev-toestel, geen productie-pad): ${devFallback}`,
    );
    return devFallback;
  }
  throw new Error(
    "Geen Chrome, Edge, of Playwright-Chromium gevonden. Installeer Google Chrome " +
      "(YAD's extensie vereist dit toch al) en probeer opnieuw.",
  );
}
