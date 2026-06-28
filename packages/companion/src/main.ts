import process, { stdin, stdout, stderr } from "node:process";
import { newId, type BrainMessage } from "@yad/shared";
import { NativeHost } from "./native-host.js";
import { BrainSession } from "./session.js";
import { buildPool } from "./engine/pool.js";
import { LlmRouter } from "./engine/router.js";
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
  const info: CompanionInfo = {
    companionVersion: COMPANION_VERSION,
    tenantId: process.env["YAD_TENANT_ID"] ?? "local",
    sessionId: newId(),
  };

  const router = new LlmRouter(buildPool(), { log: (m) => log(`[motor] ${m}`) });

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

  stdin.on("end", () => {
    log("stdin gesloten door Chrome, companion sluit af");
    process.exit(0);
  });
}

main();
