/**
 * launch — het dubbelklikbare startpunt (aangeroepen door launch.bat) voor
 * "YAD openen als een gewoon programma". Doet twee dingen:
 *
 *   1. Start de lokale server (dist/main.js) ALS die nog niet luistert op de
 *      gekozen poort — en wacht kort tot hij dat wél doet.
 *   2. Opent een systeem-Chrome (of Edge/Playwright-Chromium als terugval,
 *      zie chrome-path.ts) in app-modus (--app=...) gericht op die server —
 *      dit verbergt tabbalk + adresbalk, wat aanvoelt als een los venster
 *      i.p.v. een browsertab.
 *
 * Dit Chrome-venster is ALLEEN de UI-schil: een compleet ANDER browserproces
 * dan de PlaywrightHand die de eigenlijke automatiseringstaak uitvoert (zie
 * runner.ts) — die twee vensters staan volledig los van elkaar.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import process from "node:process";
import { resolveBrowserExecutable } from "./chrome-path.js";

const PORT = parseInt(process.env["YAD_DESKTOP_PORT"] ?? "3761", 10);
const HOST = process.env["YAD_DESKTOP_HOST"] ?? "127.0.0.1";
const APP_URL = `http://${HOST}:${PORT}/`;

// launch.js en main.js staan na de build beide plat in dist/.
const here = dirname(fileURLToPath(import.meta.url));
const mainPath = join(here, "main.js");
const logDir = join(here, "..", "log");

function log(m: string): void {
  console.log(`[yad-launch] ${m}`);
}

/** Draait er al iets op APP_URL? Korte timeout — dit mag de opstart niet lang blokkeren. */
async function isServerUp(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`${APP_URL}run/status`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** Start de server als losstaand achtergrondproces (overleeft dit launcher-script). */
function startServer(): void {
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, "server.log");
  // createWriteStream() geeft een object terug waarvan de onderliggende file
  // descriptor pas ná een async 'open'-event bestaat — spawn()'s stdio-optie
  // verwacht op dat moment al een écht fd en gooit synchroon ("argument
  // 'stdio' is invalid"). openSync() geeft direct een numeriek fd terug, wat
  // stdio wél accepteert. Bevestigd als de daadwerkelijke, 100%-reproduceerbare
  // crash-oorzaak van elke eerste-opstart tijdens de live benchmark van vandaag.
  const logFd = openSync(logFile, "a");
  log(`Server nog niet actief — start dist/main.js (log: ${logFile})`);
  const child = spawn(process.execPath, [mainPath], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  // Het launcher-proces heeft de fd's zelf niet meer nodig zodra het kind ze
  // heeft overgenomen bij spawn — sluiten om geen handle te lekken in dit
  // proces (het kind houdt zijn eigen kopie, dus dit sluit de logging niet af).
  closeSync(logFd);
  // Zonder deze listener wordt een spawn-fout (bv. process.execPath ineens
  // onbereikbaar) een ongevangen 'error'-event op deze ChildProcess — Node's
  // standaard EventEmitter-gedrag laat dat het HELE launcher-proces crashen
  // met een rauwe stack trace, buiten bereik van main().catch() hieronder
  // (dat event vuurt async, niet binnen main()'s eigen await-keten). Hier
  // vangen we het, loggen we het duidelijk, en laten we waitForServer()
  // hieronder gewoon zijn eigen (nette) timeout-pad afhandelen.
  child.on("error", (err) => {
    log(`Kon dist/main.js niet starten: ${err.message}`);
  });
  // Losmaken van dit launcher-proces: de server moet blijven draaien nadat
  // launch.ts/launch.bat klaar is — het Chrome-venster hieronder is straks
  // het enige wat de gebruiker nog ziet.
  child.unref();
}

async function waitForServer(maxMs = 15_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    if (await isServerUp()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * Opent het app-venster. Geeft een Promise terug die pas oplost zodra spawn()
 * écht is gelukt (het 'spawn'-event) of écht is mislukt (het 'error'-event) —
 * zonder dit zou een spawn-fout (bv. chrome.exe bestaat volgens existsSync()
 * wel maar is geblokkeerd door antivirus, half-geïnstalleerd, of ontbreekt de
 * uitvoer-permissie) hetzelfde ongevangen-'error'-crashpad raken als
 * startServer() hierboven — mét de bijkomende makkelijk te verwarren situatie
 * dat de server op dat moment al wél draait (zie startServer()'s child.unref()).
 */
function openAppWindow(): Promise<void> {
  const exe = resolveBrowserExecutable(log);
  log(`Open venster via: ${exe}`);
  return new Promise((resolve) => {
    const child = spawn(exe, [`--app=${APP_URL}`, "--window-size=1280,860", "--new-window"], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (err) => {
      log(`Kon de browser niet starten (${exe}): ${err.message}`);
      log(`Mogelijk geblokkeerd door antivirus, of een beschadigde/onvolledige installatie.`);
      process.exitCode = 1;
      resolve();
    });
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  if (await isServerUp()) {
    log(`Server draait al op ${APP_URL}`);
  } else {
    startServer();
    const up = await waitForServer();
    if (up) {
      log(`Server actief op ${APP_URL}`);
    } else {
      // Vroeger werd hier alsnog openAppWindow() aangeroepen: de gebruiker
      // kreeg dan een kaal "deze site kan niet bereikt worden"-venster te
      // zien zonder enige YAD-eigen uitleg, terwijl de échte reden (met de
      // "controleer log/server.log"-hint) alleen in dit inmiddels gesloten
      // console-venster stond. Nu: geen venster openen, wél een duidelijke
      // exitcode zodat launch.bat's foutmelding + pause zichtbaar blijven.
      log(
        `Server startte niet binnen de tijd (15s) — controleer log/server.log. ` +
          `Venster wordt NIET geopend om geen kale foutpagina te tonen.`,
      );
      process.exitCode = 1;
      return;
    }
  }
  await openAppWindow();
}

main().catch((e: Error) => {
  console.error(`[yad-launch] Onverwachte fout: ${e.message}`);
  process.exit(1);
});
