/**
 * Rooktest: start het ECHTE companion-proces via de launcher (zoals Chrome dat
 * doet) en doet een native-messaging handshake over een echte pipe.
 * Bewijst dat launcher + node + companion samen werken, zonder browser.
 *
 * Draai: pnpm smoke-host   (na pnpm build + pnpm setup-host)
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const launcher = resolve(repoRoot, "native-messaging", "yad-companion-launcher.bat");

if (!existsSync(launcher)) {
  console.error(`Launcher niet gevonden: ${launcher}. Draai eerst pnpm setup-host.`);
  process.exit(1);
}

function frame(obj: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

const hello = {
  v: 1,
  id: "smoke-1",
  type: "HELLO",
  payload: { extId: "smoketest", clientVersion: "smoke", capabilities: [] },
};

// Chrome geeft de origin als eerste argument mee; de companion negeert het.
const child = spawn("cmd.exe", ["/c", launcher, "chrome-extension://smoketest/"], {
  windowsHide: true,
});

let buf = Buffer.alloc(0);
let done = false;

child.stdout.on("data", (chunk: Buffer) => {
  buf = Buffer.concat([buf, chunk]);
  if (done || buf.length < 4) return;
  const len = buf.readUInt32LE(0);
  if (buf.length < 4 + len) return;
  const body = buf.subarray(4, 4 + len).toString("utf8");
  done = true;
  try {
    const msg = JSON.parse(body) as { type?: string; correlationId?: string; payload?: unknown };
    if (msg.type === "HELLO_ACK" && msg.correlationId === "smoke-1") {
      console.log("SMOKE OK: HELLO_ACK van het echte companion-proces:", JSON.stringify(msg.payload));
      cleanup(0);
    } else {
      console.error("SMOKE FAIL: onverwacht antwoord:", body);
      cleanup(1);
    }
  } catch (e) {
    console.error("SMOKE FAIL: kon antwoord niet parsen:", body, e);
    cleanup(1);
  }
});

child.stderr.on("data", (d: Buffer) => process.stderr.write(d)); // companion logt naar stderr

child.on("error", (e) => {
  console.error("SMOKE FAIL: kon launcher niet starten:", e.message);
  cleanup(1);
});

const timer = setTimeout(() => {
  if (!done) {
    console.error("SMOKE FAIL: timeout, geen HELLO_ACK binnen 5s");
    cleanup(1);
  }
}, 5000);

function cleanup(code: number): void {
  clearTimeout(timer);
  try {
    child.kill();
  } catch {
    /* leeg */
  }
  process.exit(code);
}

// Stuur de HELLO zodra het proces er is.
child.stdin.write(frame(hello));
