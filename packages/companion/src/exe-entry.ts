/**
 * Enig invoerpunt voor de losse Companion-.exe (SEA, Weg B).
 *
 * Twee standen, onderscheiden aan de argumenten waarmee de .exe start:
 *   - Chrome start de native-messaging host -> argv bevat "chrome-extension://..."
 *     -> host-modus: draai het Brein (main.ts).
 *   - De gebruiker dubbelklikt YAD-Setup.exe -> geen zulk argument
 *     -> installer-modus: register zetten (installer.ts).
 *
 * We scannen de VOLLEDIGE argv (niet slice) omdat een SEA-.exe geen script-arg
 * op vaste index heeft; het exe-pad zelf begint nooit met "chrome-extension://".
 */
import process from "node:process";
import { join } from "node:path";
import { installSelf } from "./installer.js";

const isHostLaunch = process.argv.some((a) => a.startsWith("chrome-extension://"));

if (isHostLaunch) {
  // Consument-host: geen lokale HTTP-API openen (voorkomt poortconflict als Chrome
  // de host opnieuw start) en schrijf geheugen naar een schrijfbare gebruikersmap.
  process.env["YAD_NO_HTTP"] = "1";
  if (!process.env["YAD_DATA_DIR"]) {
    const base =
      process.env["LOCALAPPDATA"] ??
      join(process.env["USERPROFILE"] ?? process.cwd(), "AppData", "Local");
    process.env["YAD_DATA_DIR"] = join(base, "YAD", "data");
  }
  // Dynamisch importeren zodat main.ts pas draait NADAT de env hierboven staat.
  void import("./main.js");
} else {
  installSelf();
}
