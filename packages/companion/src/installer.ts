/**
 * Installer-modus van de losse Companion-.exe (Weg B).
 *
 * Wordt uitgevoerd wanneer de gebruiker YAD-Setup.exe dubbelklikt (er is dan
 * geen chrome-extension:// argument, zie exe-entry.ts). Het:
 *   1. kopieert zichzelf naar %LOCALAPPDATA%\YAD\yad-companion.exe,
 *   2. schrijft het native-messaging-manifest dat naar die kopie wijst,
 *   3. registreert dat manifest in HKCU voor Chrome en Edge (geen admin nodig).
 *
 * Daarna start Chrome de Companion zelf zodra de extensie verbindt — geen
 * achtergronddienst en geen auto-start nodig.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";

const HOST_NAME = "com.yad.companion";

// De extensie-ID's die met de Companion mogen praten: de winkelversie en de
// lokale ontwikkelversie. Gelijk aan native-messaging/com.yad.companion.json.
const ALLOWED_ORIGINS = [
  "chrome-extension://dacfhekkemkiikecbjffmbdcohddodea/",
  "chrome-extension://lblmbkbfifppfaljefkhpankggekhlfn/",
];

function installDir(): string {
  // YAD_INSTALL_DIR: volledige doelmap overschrijven (draagbare/silent installaties,
  // en zo kan de installer getest worden zonder de echte gebruikersmap te raken).
  const override = process.env["YAD_INSTALL_DIR"];
  if (override) return override;
  const base =
    process.env["LOCALAPPDATA"] ??
    join(process.env["USERPROFILE"] ?? process.cwd(), "AppData", "Local");
  return join(base, "YAD");
}

/** Toont een echte Windows-dialoog zodat de gebruiker de bevestiging ziet. */
function userDialog(title: string, message: string): void {
  try {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-Command",
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(${JSON.stringify(
          message,
        )}, ${JSON.stringify(title)}) | Out-Null`,
      ],
      { stdio: "ignore" },
    );
  } catch {
    // De dialoog is bijzaak; de console-uitvoer blijft de bron van waarheid.
  }
}

export function installSelf(): void {
  const dir = installDir();
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });

  // 1. Zichzelf naar de installatiemap kopieren, los van waar de download staat.
  const destExe = join(dir, "yad-companion.exe");
  copyFileSync(process.execPath, destExe);

  // 2. Native-messaging-manifest schrijven dat naar de gekopieerde .exe wijst.
  const manifest = {
    name: HOST_NAME,
    description: "Yad companion (het Brein) native messaging host",
    path: destExe,
    type: "stdio",
    allowed_origins: ALLOWED_ORIGINS,
  };
  const manifestPath = join(dir, `${HOST_NAME}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  // 3. Registreren in HKCU (huidige gebruiker, geen adminrechten) voor Chrome en Edge.
  // YAD_SKIP_REGISTER=1 slaat dit over (voor testen of een aparte registratiestap).
  if (process.env["YAD_SKIP_REGISTER"] !== "1") {
    const keys = [
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
    ];
    for (const key of keys) {
      execFileSync("reg", ["add", key, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], {
        stdio: "ignore",
      });
    }
  }

  const done =
    "Yad is geinstalleerd.\n\n" +
    "Open Chrome, klik het Yad-icoon rechtsboven en je kunt beginnen. " +
    "Je hoeft dit venster niet open te houden.";
  process.stdout.write(done + "\n");
  // YAD_SILENT=1 onderdrukt de dialoog (stille/scriptbare installatie voor bedrijven).
  if (process.env["YAD_SILENT"] !== "1") userDialog("Yad", done);
}
