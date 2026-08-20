/**
 * Poort voor niet-localhost verzoeken naar de HTTP-API (Micromanagement spoor 4).
 *
 * Wordt in http-api.ts ALLEEN aangeroepen wanneer het request niet van
 * 127.0.0.1/::1 komt. Lokaal verkeer (Claude Code) raakt deze module dus nooit —
 * het bestaande gedrag voor de huidige integratie blijft volledig ongewijzigd.
 *
 * Standaard (YAD_EXTERNAL_MODE niet gezet) = elk niet-lokaal verzoek blijft
 * geweigerd met exact dezelfde 403 als voorheen. Pas als de eigenaar van de
 * machine bewust YAD_EXTERNAL_MODE=1 + YAD_API_KEYS zet, wordt een klein,
 * whitelisted deel van de API extern bereikbaar — met key-auth, rate-limit
 * en audit-log.
 *
 * HARDE REGEL (veiligheidsaudit 2026-07-19, NOOIT VERGETEN):
 * De hele localhost-vs-extern-grens in http-api.ts leunt op
 * req.socket.remoteAddress. Zet NOOIT een reverse-proxy of tunnel
 * (nginx/cloudflared/ngrok/etc.) op DEZELFDE machine vóór deze poort zonder
 * eerst een apart lokaal-geheim (bv. verplichte X-Yad-Local-Token header
 * voor het echte localhost-pad) toe te voegen. Een lokaal draaiende proxy
 * verbindt zelf vanaf 127.0.0.1, dus elk extern verzoek dat erdoorheen komt
 * ziet er voor deze server uit als vertrouwd lokaal verkeer — dan wordt
 * checkExternalGate() volledig overgeslagen en krijgt een willekeurige
 * klant ongeauthenticeerde toegang tot /cdp/evaluate (JS-executie in de
 * browser), /fs/read-file (elk bestand op deze machine) en
 * /cdp/cookies/set (sessie-kaping). Dit is de meest waarschijnlijke route
 * naar een productie-incident zodra dit ooit publiek gaat — fix dit EERST
 * (los lokaal token, of terminate TLS/publieke toegang op een fysiek
 * gescheiden machine) voordat er een reverse-proxy bij komt.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

/** MVP-scope: alleen read-only status + gestuurd doel. Alle cdp/*, fs/*, save-session etc. blijven dicht. */
const ALLOWED_EXTERNAL_ROUTES: ReadonlyArray<{ url: string; method: string }> = [
  { url: "/status", method: "GET" },
  { url: "/goal", method: "POST" },
];

const hitLog = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (hitLog.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  hits.push(now);
  hitLog.set(key, hits);
  return hits.length > RATE_LIMIT_MAX;
}

function auditLogPath(): string {
  const explicit = process.env["YAD_EXTERNAL_AUDIT_PATH"];
  if (explicit && explicit.length > 0) return explicit;
  // Dev (repo): relatief aan deze module. import.meta.url is undefined in een CJS-bundel,
  // dus afschermen en terugvallen op cwd/data i.p.v. crashen.
  try {
    const url = import.meta.url;
    if (url) {
      const here = dirname(fileURLToPath(url));
      return join(here, "..", "data", "external-audit.jsonl");
    }
  } catch {
    /* bundel zonder module-url */
  }
  return join(process.cwd(), "data", "external-audit.jsonl");
}

function auditLog(entry: Record<string, unknown>): void {
  try {
    const path = auditLogPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    // audit-logging mag een verzoek nooit blokkeren of laten crashen
  }
}

export interface GateResult {
  allow: boolean;
  status: number;
  body: unknown;
}

function apiKeysFromEnv(): string[] {
  return (process.env["YAD_API_KEYS"] ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Controleert een niet-lokaal verzoek. Geeft altijd een expliciete allow/deny + status/body terug. */
export function checkExternalGate(req: IncomingMessage, url: string, method: string): GateResult {
  const remoteAddr = req.socket.remoteAddress ?? "unknown";
  const externalMode = process.env["YAD_EXTERNAL_MODE"] === "1";

  if (!externalMode) {
    return { allow: false, status: 403, body: { error: "Forbidden — alleen localhost" } };
  }

  const routeAllowed = ALLOWED_EXTERNAL_ROUTES.some((r) => r.url === url && r.method === method);
  if (!routeAllowed) {
    auditLog({ remoteAddr, url, method, verdict: "blocked", reason: "not_allowlisted" });
    return { allow: false, status: 403, body: { error: "Forbidden — endpoint niet beschikbaar in externe modus" } };
  }

  const apiKeys = apiKeysFromEnv();
  if (apiKeys.length === 0) {
    auditLog({ remoteAddr, url, method, verdict: "blocked", reason: "no_api_keys_configured" });
    return { allow: false, status: 503, body: { error: "Externe modus actief maar geen YAD_API_KEYS geconfigureerd" } };
  }

  const provided = req.headers["x-api-key"];
  const key = Array.isArray(provided) ? provided[0] : provided;
  if (!key || !apiKeys.includes(key)) {
    auditLog({ remoteAddr, url, method, verdict: "blocked", reason: "invalid_api_key" });
    return { allow: false, status: 401, body: { error: "Unauthorized — geldige X-API-Key header vereist" } };
  }

  if (isRateLimited(`${remoteAddr}:${key}`)) {
    auditLog({ remoteAddr, url, method, verdict: "blocked", reason: "rate_limited" });
    return { allow: false, status: 429, body: { error: "Rate limit overschreden — max 20 verzoeken/minuut" } };
  }

  auditLog({ remoteAddr, url, method, verdict: "allowed" });
  return { allow: true, status: 200, body: null };
}
