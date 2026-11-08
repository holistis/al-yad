#!/usr/bin/env node
/**
 * Proves that scripts/extension-smoke.mjs can fail. It builds the store variant, requires the
 * smoke test to pass on the untouched build, then plants one fault at a time in a copy of the
 * build and requires the smoke test to fail on each, with the check that is meant to catch it.
 *
 * The faults: a manifest without a service worker, Manifest V2, an added and a removed
 * permission, a debugger permission in the store build, a wrong version, a missing service
 * worker file, side panel page and content script, a service worker that throws or logs an
 * error, a side panel that throws or loads a missing file, a content script that does nothing,
 * a legal page without text, and a missing dialog trap.
 *
 * Usage: node scripts/extension-smoke.selftest.mjs
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SMOKE = join(HERE, "extension-smoke.mjs");
const BUILT = join(resolve(HERE, ".."), "packages", "extension", ".output-winkel", "chrome-mv3");

function smoke(args) {
  const run = spawnSync(process.execPath, [SMOKE, ...args], { encoding: "utf8", timeout: 180_000 });
  return { status: run.status, out: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

const edit = (dir, file, fn) => {
  const path = join(dir, file);
  writeFileSync(path, fn(readFileSync(path, "utf8")));
};
const editManifest = (fn) => (dir) => edit(dir, "manifest.json", (text) => JSON.stringify(fn(JSON.parse(text))));
const firstSidePanelChunk = (dir) => join("chunks", readdirSync(join(dir, "chunks")).find((f) => f.startsWith("sidepanel-") && f.endsWith(".js")));

// Each fault names the check that must report it, so a failure for some other reason does not count.
const faults = [
  { name: "manifest without a service worker", expect: /FAIL manifest declares a background service_worker/, plant: editManifest((m) => (delete m.background, m)) },
  { name: "Manifest V2", expect: /FAIL manifest_version is 3/, plant: editManifest((m) => ({ ...m, manifest_version: 2 })) },
  { name: "added permission", expect: /FAIL permissions unchanged against the baseline/, plant: editManifest((m) => ({ ...m, permissions: [...m.permissions, "history"] })) },
  { name: "removed permission", expect: /FAIL permissions unchanged against the baseline/, plant: editManifest((m) => ({ ...m, permissions: m.permissions.filter((p) => p !== "storage") })) },
  { name: "added host permission", expect: /FAIL host_permissions unchanged against the baseline/, plant: editManifest((m) => ({ ...m, host_permissions: [...m.host_permissions, "https://example.com/*"] })) },
  { name: "debugger permission in the store build", noBaseline: true, expect: /FAIL store variant has neither debugger nor cookies permission/, plant: editManifest((m) => ({ ...m, permissions: [...m.permissions, "debugger"] })) },
  { name: "wrong version", extraArgs: ["--expect-version", "9.9.9"], expect: /FAIL manifest version is 9\.9\.9/, plant: () => {} },
  { name: "service worker file missing", expect: /FAIL service worker file background\.js exists/, plant: (dir) => rmSync(join(dir, "background.js")) },
  { name: "side panel page missing", expect: /FAIL side panel page sidepanel\.html exists/, plant: (dir) => rmSync(join(dir, "sidepanel.html")) },
  { name: "content script file missing", expect: /FAIL all \d+ files named by content scripts and icons exist/, plant: (dir) => rmSync(join(dir, "content-scripts", "content.js")) },
  { name: "service worker throws at startup", expect: /FAIL the service worker answers YAD_GET_STATUS/, plant: (dir) => writeFileSync(join(dir, "background.js"), 'throw new Error("planted startup failure");') },
  { name: "service worker logs an error", expect: /FAIL no console errors/, plant: (dir) => edit(dir, "background.js", (t) => t + '\nconsole.error("planted worker error");') },
  { name: "side panel script throws", expect: /FAIL no console errors/, plant: (dir) => edit(dir, firstSidePanelChunk(dir), (t) => t + '\nthrow new Error("planted side panel error");') },
  { name: "side panel loads a missing file", expect: /FAIL no console errors/, plant: (dir) => edit(dir, "sidepanel.html", (t) => t.replace("</body>", '<script src="missing-file.js"></script></body>')) },
  { name: "content script does nothing", expect: /FAIL the content script answers YAD_PING/, plant: (dir) => writeFileSync(join(dir, "content-scripts", "content.js"), "/* planted: empty */") },
  { name: "dialog trap missing", expect: /FAIL the main-world dialog trap/, plant: (dir) => writeFileSync(join(dir, "content-scripts", "dialoog-vangnet.js"), "/* planted: empty */") },
  { name: "legal page without text", expect: /FAIL legal\/privacy-kort\.html opens with text/, plant: (dir) => writeFileSync(join(dir, "legal", "privacy-kort.html"), "<!doctype html><title>x</title>") },
];

console.log("Control run on the untouched build ...");
const control = smoke([]);
let failures = 0;
const report = (ok, label, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) {
    failures++;
    if (detail) console.log(detail.trim().split("\n").slice(-6).join("\n"));
  }
};
report(control.status === 0, "the untouched build passes", control.out);

const work = mkdtempSync(join(tmpdir(), "yad-extension-selftest-"));
try {
  const baselineManifest = join(work, "baseline-manifest.json");
  writeFileSync(baselineManifest, readFileSync(join(BUILT, "manifest.json")));
  faults.forEach((fault, i) => {
    const copy = join(work, `case-${i}`);
    cpSync(BUILT, copy, { recursive: true });
    fault.plant(copy);
    const args = ["--dir", copy, ...(fault.noBaseline ? [] : ["--baseline-manifest", baselineManifest]), ...(fault.extraArgs ?? [])];
    const result = smoke(args);
    const caught = result.status === 1 && fault.expect.test(result.out);
    report(caught, `planted fault is caught: ${fault.name}`, `exit ${result.status}\n${result.out}`);
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} self-test case(s) failed.`);
  process.exit(1);
}
console.log(`\nThe smoke test passed the untouched build and failed on all ${faults.length} planted faults.`);
