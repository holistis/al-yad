#!/usr/bin/env node
/**
 * Starts the built native-messaging bundle (dist/pair-host.js) under whichever Node runs this
 * script, does the HELLO handshake over its stdin and stdout the way Chrome does, and exits 0
 * only when a HELLO_ACK with the matching correlation id comes back.
 *
 * Why it exists: the repo builds and tests on Node 22 (vitest 5, wxt 0.21 and jsdom 30 need
 * it) while this package still declares node >=20. CI runs this script once more under Node 20,
 * so a change that breaks the published bundle on the lowest supported runtime shows up there.
 *
 * Usage: node scripts/handshake.mjs [path-to-bundle]   (default: dist/pair-host.js)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(process.argv[2] ?? join(PKG_ROOT, "dist", "pair-host.js"));
const TIMEOUT_MS = Number(process.env.YAD_HANDSHAKE_TIMEOUT_MS) || 10_000;

if (!existsSync(entry)) {
  console.error(`FAIL bundle not found: ${entry}`);
  process.exit(1);
}

// A private data directory and an unusual port, so the run never touches a companion that
// is already running on this machine or the token file of a real install.
const dataDir = mkdtempSync(join(tmpdir(), "yad-handshake-"));
const child = spawn(process.execPath, [entry, "chrome-extension://handshake/"], {
  cwd: dataDir,
  env: { ...process.env, YAD_DATA_DIR: dataDir, YAD_PORT: "39747" },
  stdio: ["pipe", "pipe", "pipe"],
});

const json = Buffer.from(
  JSON.stringify({ v: 1, id: "hs-1", type: "HELLO", payload: { extId: "handshake", clientVersion: "handshake", capabilities: [] } }),
);
const header = Buffer.alloc(4);
header.writeUInt32LE(json.length, 0);

let received = Buffer.alloc(0);
let stderr = "";
let finished = false;

function finish(code, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  child.kill();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // The temp directory is not worth failing the check over.
  }
  (code === 0 ? console.log : console.error)(message);
  process.exit(code);
}

const timer = setTimeout(
  () => finish(1, `FAIL no HELLO_ACK within ${TIMEOUT_MS / 1000}s on Node ${process.version}. stderr: ${stderr.slice(-300)}`),
  TIMEOUT_MS,
);

child.stderr.on("data", (d) => {
  stderr += d;
});
child.on("error", (e) => finish(1, `FAIL could not start the bundle: ${e.message}`));
child.on("exit", (code) => finish(1, `FAIL bundle exited early with code ${code} on Node ${process.version}. stderr: ${stderr.slice(-300)}`));
child.stdout.on("data", (chunk) => {
  received = Buffer.concat([received, chunk]);
  if (received.length < 4) return;
  const length = received.readUInt32LE(0);
  if (received.length < 4 + length) return;
  let message;
  try {
    message = JSON.parse(received.subarray(4, 4 + length).toString("utf8"));
  } catch (e) {
    finish(1, `FAIL could not parse the reply: ${e.message}`);
    return;
  }
  if (message.type === "HELLO_ACK" && message.correlationId === "hs-1") {
    finish(0, `OK   HELLO_ACK from ${entry} on Node ${process.version}`);
  } else {
    finish(1, `FAIL unexpected reply: ${JSON.stringify(message).slice(0, 200)}`);
  }
});

child.stdin.write(Buffer.concat([header, json]));
