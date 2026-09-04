#!/usr/bin/env node
/**
 * Sanity checks for the built npm package, run after scripts/build.mjs.
 *
 * Not a full end-to-end test (that needs a real Chrome + extension for the
 * pair path, and a real Ollama instance for the serve path, neither of which
 * belongs in an automated check). This catches the class of bug that already
 * happened once while building this package: a bundled file computing a path
 * back into a monorepo layout that no longer exists once packaged.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(PKG_ROOT, "dist");

let failures = 0;
function check(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures++;
}

const requiredFiles = ["pair-host.js", "serve.js", "setup-host.js", "register-host.ps1"];
for (const f of requiredFiles) {
  check(`${f} exists in dist/`, existsSync(join(DIST, f)));
}

const setupHostSource = readFileSync(join(PKG_ROOT, "src", "setup-host-npm.mjs"), "utf8");
check(
  "setup-host-npm.mjs points the companion entry at a sibling file, not a monorepo-relative path",
  /join\(here, ["']pair-host\.js["']\)/.test(setupHostSource)
);
check(
  "setup-host-npm.mjs stores keys and the manifest under the home directory, not inside the package install path",
  /homedir\(\)/.test(setupHostSource) && !/resolve\(here, ["']\.\.["']\)/.test(setupHostSource)
);

const registerHostSource = readFileSync(join(PKG_ROOT, "src", "register-host-npm.ps1"), "utf8");
// Strip comment lines first: the file's own header comment explains, in
// prose, what the OLD script did wrong ($PSScriptRoot), which would
// otherwise false-positive a naive whole-file search for that string.
const registerHostCode = registerHostSource
  .split("\n")
  .filter(line => !line.trim().startsWith("#"))
  .join("\n");
check(
  "register-host-npm.ps1's executable code reads the manifest from the home directory, not from $PSScriptRoot",
  /\$env:USERPROFILE/.test(registerHostCode) && !/\$PSScriptRoot/.test(registerHostCode)
);

const pkgJson = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
check("package.json has no workspace: dependency ranges", !JSON.stringify(pkgJson.dependencies || {}).includes("workspace:"));
check("package.json declares a bin entry", Boolean(pkgJson.bin && pkgJson.bin.yadagent));
check("README.md exists", existsSync(join(PKG_ROOT, "README.md")));
check("LICENSE exists", existsSync(join(PKG_ROOT, "LICENSE")));

const cli = readFileSync(join(PKG_ROOT, "bin", "yadagent.js"), "utf8");
check("CLI refuses to start serve without OLLAMA_BASE_URL", /OLLAMA_BASE_URL/.test(cli) && /process\.exit\(1\)/.test(cli));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
