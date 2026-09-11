#!/usr/bin/env node
/**
 * npm-package specific variant of the monorepo's scripts/setup-native-host.ts.
 *
 * Not a thin wrapper around that script, a separate file, because two of its
 * path assumptions are wrong once this runs from an installed npm package
 * rather than from inside the monorepo, and getting either wrong breaks the
 * extension pairing in a way nobody notices until it silently stops working:
 *
 * 1. The original computes the companion entry point as a path relative to a
 *    monorepo layout (packages/companion/dist/main.js) that does not exist
 *    once this is bundled and published. Verified live: running the bundled
 *    original inside this package computed
 *    ".../npm-package/packages/companion/dist/main.js", a path that has
 *    never existed. Fixed here by pointing at the sibling pair-host.js file
 *    in this same package's own dist folder instead.
 *
 * 2. The original stores the generated extension private key and the host
 *    manifest under a path derived from the script's own location, which for
 *    an npm package resolves to somewhere inside this package's install
 *    directory, effectively inside node_modules. Reinstalling or updating the
 *    package deletes and recreates node_modules, which would silently
 *    regenerate the private key, which changes the derived extension ID,
 *    which breaks the pairing with the extension the user already has
 *    installed, with no error message pointing at the cause. Fixed here by
 *    storing both in ~/.yadagent, a stable location that survives package
 *    reinstalls, matching the common CLI convention of a dotfile directory in
 *    the user's home.
 *
 * Everything else (key generation, extension ID derivation, manifest shape,
 * the known store IDs) is unchanged from the original.
 */
import {
  generateKeyPairSync,
  createHash,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));

// This file lives at <package>/dist/setup-host.js once bundled, and
// pair-host.js is bundled to the same directory in the same build step, so it
// is always a sibling, never a path computed through a monorepo layout.
const companionEntry = join(here, "pair-host.js");

// Multi-instance support: running `YAD_INSTANCE=b YAD_PORT=4001 npx yadagent
// pair` sets up a second, fully independent companion (its own config dir,
// its own native-messaging host name, its own port, its own log files),
// so a second Chrome profile can pair with it without colliding with a
// default install already running. Leaving both unset reproduces today's
// single-instance behaviour exactly, byte for byte.
const instance = (process.env["YAD_INSTANCE"] ?? "").trim();
const instancePort = process.env["YAD_PORT"];

// Validated up front, not left to fail later: an instance name that isn't
// [a-zA-Z0-9_-] would still "succeed" here (write files, print success) but
// silently produce an invalid native-messaging host name (Chrome rejects
// anything outside roughly [\w.]+ for the manifest "name" field) or, worse,
// a slash in the name turns straight into a broken file path with a raw
// ENOENT stack trace instead of a message that says what actually went
// wrong. Caught here once, instead of at pairing time with no clear cause.
const INSTANCE_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
if (instance && !INSTANCE_NAME_RE.test(instance)) {
  console.error(
    `YAD_INSTANCE is "${instance}", which is not a safe instance name. Use only letters, digits, "_" and ` +
    `"-", 1-32 characters (e.g. "b", "second", "test-account"). No spaces, dots, or slashes: those either break ` +
    `the native-messaging host name Chrome will accept, or the file paths this script writes.`
  );
  process.exit(1);
}

if (instance && !instancePort) {
  console.error(
    `YAD_INSTANCE is set to "${instance}" but YAD_PORT is not. A named instance needs its own port ` +
    `(any free port other than 3747) so it never fights the default instance for the same one. ` +
    `Example: YAD_INSTANCE=${instance} YAD_PORT=4001 npx yadagent pair`
  );
  process.exit(1);
}

// A mistyped/copy-pasted YAD_PORT that happens to equal the default port
// would otherwise "succeed" silently here: every file gets written, the
// script prints success, and the collision only surfaces much later when
// Chrome actually spawns this instance's companion and its HTTP API loses
// the port race against whichever instance grabbed 3747 first (see
// http-api.ts's EADDRINUSE handling — it logs and keeps running with no
// HTTP API, it does not crash, so there would be no obvious error either).
const parsedPort = instancePort !== undefined ? Number(instancePort) : undefined;
if (instance && (parsedPort === 3747 || !Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535)) {
  console.error(
    `YAD_PORT is "${instancePort}", which is not usable for a named instance: it must be a distinct port number ` +
    `from 1-65535, and NOT 3747 (that is always the default instance's port, reusing it here would silently ` +
    `collide the moment both instances actually run). Example: YAD_INSTANCE=${instance} YAD_PORT=4001 npx yadagent pair`
  );
  process.exit(1);
}

const CONFIG_DIR = instance ? join(homedir(), `.yadagent-${instance}`) : join(homedir(), ".yadagent");
const keysDir = join(CONFIG_DIR, "keys");
const nmDir = join(CONFIG_DIR, "native-messaging");
const logsDir = join(CONFIG_DIR, "logs");
const dataDir = join(CONFIG_DIR, "data");

const HOST_NAME = instance ? `com.yad.companion.${instance}` : "com.yad.companion";

mkdirSync(keysDir, { recursive: true });
mkdirSync(nmDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

if (!existsSync(companionEntry)) {
  console.error(`Expected the bundled companion at ${companionEntry}, did not find it. This is a packaging bug, not something you did wrong.`);
  process.exit(1);
}

// 1. Sleutel: hergebruik bestaande private key, anders nieuwe genereren.
const privPath = join(keysDir, "ext-private.pem");
let publicDer;
if (existsSync(privPath)) {
  const privPem = readFileSync(privPath, "utf8");
  const keyObj = createPrivateKey(privPem);
  publicDer = createPublicKey(keyObj).export({ type: "spki", format: "der" });
  console.log(`Reusing existing extension key from ${privPath}.`);
  // Re-tighten permissions on an existing key too, in case it predates this fix
  // (created world/group-readable on a non-Windows machine). No-op on Windows.
  try { chmodSync(privPath, 0o600); } catch { /* best effort */ }
} else {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  publicDer = publicKey;
  writeFileSync(privPath, privateKey, "utf8");
  // Private key: owner-only. writeFileSync uses the process umask, which on a
  // shared/multi-user Linux or macOS machine can leave this group/world-readable.
  try { chmodSync(privPath, 0o600); } catch { /* best effort */ }
  console.log(`Generated a new extension key at ${privPath}. Keep this file: deleting it changes your extension ID and breaks pairing with an already-installed extension.`);
}

// 2. manifest "key" = base64 of the DER public key.
const manifestKey = publicDer.toString("base64");

// 3. extension ID = first 16 bytes of sha256(publicDer), hex, mapped 0-f -> a-p.
const hashHex = createHash("sha256").update(publicDer).digest("hex").slice(0, 32);
const extId = [...hashHex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join("");

writeFileSync(join(keysDir, "manifest-key.txt"), manifestKey, "utf8");
writeFileSync(join(keysDir, "ext-id.txt"), extId, "utf8");

// 5. Windows launcher: Chrome's native-messaging "path" cannot carry
// arguments, so `node <companion>` is wrapped in a .bat, same approach as the
// monorepo version, using the absolute node.exe path since Chrome does not
// always inherit PATH.
//
// The `set` lines exist because the bundled companion (main.ts, via
// http-api.ts and session.ts) falls back to a handful of hardcoded
// C:\Code\... paths when these env vars are not set. That default is fine
// inside the monorepo, where those paths are what the maintainer's own
// tooling already expects, but it is wrong for anyone else: their C:\Code
// likely does not exist, and this is the only place that launches the
// bundled companion for an external install, so it is also the only correct
// place to override it. The shared source in http-api.ts/session.ts is left
// exactly as the monorepo needs it.
//
// YAD_BRIDGE_PATH was missing here for a while: session.ts reads it too
// (the capture/page-state bridge file), and without it every external
// `npx yadagent pair` install was silently writing that file to
// C:\Code\yad-claude-bridge.json on the *user's* machine instead of into
// their own ~/.yadagent/logs — harmless if C:\Code happens to exist and be
// writable, a confusing silent failure if it does not. Fixed here, for the
// default instance and not just for named ones.
//
// YAD_PORT and YAD_DATA_DIR are only set for a named instance (`instance`
// truthy). The default instance keeps relying on http-api.ts's own 3747
// fallback and each store's own no-YAD_DATA_DIR fallback, unchanged, so a
// plain `npx yadagent pair` with neither YAD_INSTANCE nor YAD_PORT set
// behaves exactly as it always has.
const launcherPath = join(nmDir, "yad-companion-launcher.bat");
const nodeBin = process.execPath.replace(/"/g, '""');
const launcherLines = [
  "@echo off",
  `set "YAD_STEP_LOG_PATH=${join(logsDir, "step-log.jsonl")}"`,
  `set "YAD_RESULT_PATH=${join(logsDir, "goal-result.json")}"`,
  `set "YAD_STUCK_PATH=${join(logsDir, "stuck.json")}"`,
  `set "YAD_BRIDGE_PATH=${join(logsDir, "claude-bridge.json")}"`,
];
if (instance) {
  launcherLines.push(`set "YAD_PORT=${instancePort}"`);
  launcherLines.push(`set "YAD_DATA_DIR=${dataDir}"`);
}
launcherLines.push(`"${nodeBin}" "${companionEntry}" %*`, "");
const launcher = launcherLines.join("\r\n");
writeFileSync(launcherPath, launcher, "utf8");

// 6. Host manifest. The Chrome Web Store ID is always included alongside the
// locally-derived one: the local ID is for a manifest generated on this
// machine to test against an unpacked extension, the store ID is what an
// actual published install uses, and a manifest with only the local one would
// leave a real installed extension unable to reach the companion with no
// visible error.
const STORE_IDS = ["dacfhekkemkiikecbjffmbdcohddodea"];

const extraIds = (process.env["YAD_EXTRA_EXT_IDS"] ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const allIds = [...new Set([extId, ...STORE_IDS, ...extraIds])];

const hostManifest = {
  name: HOST_NAME,
  description: "Yad companion (het Brein) native messaging host",
  path: launcherPath,
  type: "stdio",
  allowed_origins: allIds.map(id => `chrome-extension://${id}/`),
};
const hostManifestPath = join(nmDir, `${HOST_NAME}.json`);
writeFileSync(hostManifestPath, JSON.stringify(hostManifest, null, 2) + "\n", "utf8");

console.log("");
console.log("Extension ID     :", extId);
console.log("Allowed IDs      :", allIds.length === 1 ? "local only" : allIds.join(", "));
console.log("Host manifest    :", hostManifestPath);
console.log("Launcher         :", launcherPath);
console.log("Companion entry  :", companionEntry);
