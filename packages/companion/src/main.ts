import process, { stdin, stdout, stderr } from "node:process";
import { newId, type BrainMessage } from "@yad/shared";
import { NativeHost } from "./native-host.js";
import { BrainSession } from "./session.js";
import { buildPool, buildExternalOllamaPool } from "./engine/pool.js";
import { LlmRouter } from "./engine/router.js";
import { loadEnvFile } from "./env.js";
import { startHttpApi } from "./http-api.js";
import type { CompanionInfo } from "./handshake.js";

const COMPANION_VERSION = "0.1.0";

/**
 * BELANGRIJK: stdout is het binaire native-messaging-kanaal naar Chrome.
 * Schrijf daar NOOIT logregels heen. Alle logging gaat naar stderr.
 */
function log(msg: string): void {
  stderr.write(`[yad-companion] ${msg}\n`);
}

function main(): void {
  // Laad de repo-.env (Chrome geeft de host zijn eigen environment, niet de onze).
  const envPath = loadEnvFile();
  log(envPath ? `.env geladen: ${envPath}` : "geen .env gevonden (alleen Ollama-bodem)");

  const info: CompanionInfo = {
    companionVersion: COMPANION_VERSION,
    tenantId: process.env["YAD_TENANT_ID"] ?? "local",
    sessionId: newId(),
  };

  const pool = buildPool();
  // Log welke providers brandstof hebben (zonder sleutels te tonen) — Exposure-check.
  log(`motor-pool: ${pool.map((p) => `${p.name}(t${p.tier})`).join(", ")}`);
  const router = new LlmRouter(pool, { log: (m) => log(`[motor] ${m}`) });

  // Aparte Ollama-only router voor extern/klant-verkeer (YAD_EXTERNAL_MODE) — nooit
  // de eigen gratis/betaalde sleutels van de koning. Leeg als Ollama niet geconfigureerd is.
  const externalPool = buildExternalOllamaPool();
  const externalRouter = externalPool.length > 0
    ? new LlmRouter(externalPool, { log: (m) => log(`[motor-extern] ${m}`) })
    : undefined;
  log(`extern-motor-pool: ${externalPool.length > 0 ? externalPool.map((p) => p.name).join(", ") : "GEEN (Ollama niet geconfigureerd — extern verkeer krijgt 503)"}`);

  let host!: NativeHost;
  const send = (msg: BrainMessage): void => host.send(msg);
  const session = new BrainSession(send, router, info, log);

  host = new NativeHost(
    stdin,
    stdout,
    (raw) => session.handle(raw),
    (err) => log(`framing-fout: ${err.message}`),
  );

  log(
    `gestart (v${COMPANION_VERSION}, tenant=${info.tenantId}, sessie=${info.sessionId}, ` +
      `${router.size} providers)`,
  );

  // Start lokale HTTP trigger-API zodat Claude Code autonoom commando's kan sturen.
  // In de losse consument-.exe staat YAD_NO_HTTP aan: dan geen poort openen (voorkomt conflict).
  if (!process.env["YAD_NO_HTTP"]) {
    startHttpApi(session, log, externalRouter);
  }

  stdin.on("end", () => {
    log("stdin gesloten door Chrome, companion sluit af");
    process.exit(0);
  });
}

main();
