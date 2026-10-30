/**
 * Gedeeld geheim tussen de companion en een geautoriseerde lokale aanroeper (Claude Code /
 * een ander lokaal script). Zonder dit kon LETTERLIJK elke pagina die de gebruiker ooit in
 * dezelfde browser opende, met een gewone same-machine fetch() naar 127.0.0.1:<poort>, deze
 * hele API bedienen. Een geldig loopback-adres + Host-header bewijst alleen dat het TCP-
 * pakket van deze machine komt, niet WIE het stuurde. Oorspronkelijk gebouwd voor http-api.ts
 * (2026-09-11-fix); hierheen verplaatst zodat main-server.ts exact dezelfde bescherming kan
 * hergebruiken in plaats van een tweede, losse kopie van dezelfde beveiligingslogica te
 * onderhouden (2026-09-15, na de YAD_CDP_ENDPOINT-audit die ontdekte dat main-server.ts deze
 * check helemaal miste).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export function tokenFilePath(): string {
  const dataDir = process.env["YAD_DATA_DIR"] ?? join(process.cwd(), "data");
  return join(dataDir, "companion-token.txt");
}

export function loadOrCreateAuthToken(log: (m: string) => void): string {
  const filePath = tokenFilePath();
  try {
    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, "utf8").trim();
      if (existing.length >= 32) return existing;
    }
  } catch { /* val terug op nieuw genereren */ }
  const token = randomBytes(32).toString("hex");
  try {
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, token, { encoding: "utf8", mode: 0o600 });
    try { chmodSync(filePath, 0o600); } catch { /* niet elk platform ondersteunt dit, mode hierboven dekt de meeste gevallen al */ }
    log(`[auth-token] nieuw auth-token aangemaakt: ${filePath}`);
  } catch (e) {
    log(`[auth-token] kon auth-token niet wegschrijven (${(e as Error).message}), token geldt alleen voor dit proces`);
  }
  return token;
}

export function hasValidToken(req: IncomingMessage, expected: string): boolean {
  const provided = req.headers["x-yad-token"];
  if (typeof provided !== "string" || provided.length === 0) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
