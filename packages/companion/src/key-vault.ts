import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";

/**
 * Sleutel-kluis met Windows DPAPI (via PowerShell ProtectedData, CurrentUser-scope).
 * De companion wordt zo eigenaar van de API-sleutels en bewaart ze VERSLEUTELD op schijf,
 * zodat alleen deze Windows-gebruiker ze kan ontsleutelen. Geen native module nodig, dus
 * werkt ook in de losse .exe. Op niet-Windows (dev) is de kluis een no-op: sleutels blijven
 * dan alleen in het geheugen, precies zoals vroeger.
 *
 * De sleutel gaat via stdin naar PowerShell (nooit op de commandline, zodat hij niet in de
 * proceslijst zichtbaar is).
 */
const ENCRYPT_PS =
  "Add-Type -AssemblyName System.Security; $in=[Console]::In.ReadToEnd(); " +
  "$b=[System.Text.Encoding]::UTF8.GetBytes($in); " +
  "$enc=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); " +
  "[Console]::Out.Write([Convert]::ToBase64String($enc))";

const DECRYPT_PS =
  "Add-Type -AssemblyName System.Security; $in=[Console]::In.ReadToEnd(); " +
  "$enc=[Convert]::FromBase64String($in.Trim()); " +
  "$dec=[System.Security.Cryptography.ProtectedData]::Unprotect($enc,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); " +
  "[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($dec))";

export class KeyVault {
  private readonly file?: string;
  private readonly dataDir?: string;
  private readonly available: boolean;
  private readonly log: (m: string) => void;

  constructor(opts: { dataDir?: string; log?: (m: string) => void } = {}) {
    this.dataDir = opts.dataDir;
    this.file = opts.dataDir ? join(opts.dataDir, "keys.dpapi") : undefined;
    this.available = process.platform === "win32";
    this.log = opts.log ?? ((): void => {});
  }

  /** True als versleutelde opslag mogelijk is (Windows + een data-map). */
  get isAvailable(): boolean {
    return this.available && !!this.file;
  }

  private ps(script: string, input: string): string {
    return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      input,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  }

  /** Versleutelt en bewaart de sleutel-map. No-op op niet-Windows of zonder data-map. */
  store(keys: Record<string, string>): void {
    if (!this.isAvailable || !this.file || !this.dataDir) return;
    try {
      const b64 = this.ps(ENCRYPT_PS, JSON.stringify(keys));
      mkdirSync(this.dataDir, { recursive: true });
      writeFileSync(this.file, b64, "utf8");
      this.log(`${Object.keys(keys).length} waarden versleuteld opgeslagen`);
    } catch (e) {
      this.log(`kluis opslaan faalde: ${(e as Error).message}`);
    }
  }

  /** Leest en ontsleutelt de sleutel-map. Lege map als er niets is of het niet lukt. */
  load(): Record<string, string> {
    if (!this.isAvailable || !this.file || !existsSync(this.file)) return {};
    try {
      const b64 = readFileSync(this.file, "utf8");
      const json = this.ps(DECRYPT_PS, b64);
      const obj = JSON.parse(json) as unknown;
      return obj && typeof obj === "object" ? (obj as Record<string, string>) : {};
    } catch (e) {
      this.log(`kluis lezen faalde: ${(e as Error).message}`);
      return {};
    }
  }
}
