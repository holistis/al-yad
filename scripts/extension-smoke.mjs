#!/usr/bin/env node
/**
 * Smoke test for the built Chrome extension.
 *
 * It loads the unpacked build into a real Chromium through Playwright (a persistent context
 * with --load-extension) and checks that the pieces a user depends on actually come up:
 *
 *   1. The manifest is Manifest V3, every file it names exists, and the permission list
 *      matches the variant (the store build has no debugger and no cookies). With
 *      --baseline-manifest the permissions and host permissions must be unchanged.
 *   2. The service worker starts, reports the same manifest, and answers a message.
 *   3. The side panel page and every legal page open without console errors, page errors,
 *      failed requests or error responses.
 *   4. The content script answers YAD_PING and YAD_SNAPSHOT on an ordinary web page, and the
 *      main-world dialog trap is installed there.
 *
 * Usage:
 *   node scripts/extension-smoke.mjs                         build the store variant, test it
 *   node scripts/extension-smoke.mjs --variant full          build the full variant, test it
 *   node scripts/extension-smoke.mjs --dir <unpacked build>  test a build that already exists
 *     --baseline-manifest <manifest.json>   fail on any permission change against this manifest
 *     --expect-version <x.y.z>              fail unless the manifest has this version
 *     --json <file>                         write the details of the run as JSON
 *
 * Exit code 0 only when every check passed. scripts/extension-smoke.selftest.mjs plants faults
 * in a copy of the build and requires this script to fail on each of them.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_PKG = join(ROOT, "packages", "extension");

function parseArgs(argv) {
  const opts = { variant: "store", dir: null, baseline: null, expectVersion: null, json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--variant") opts.variant = next();
    else if (a === "--dir") opts.dir = resolve(next());
    else if (a === "--baseline-manifest") opts.baseline = resolve(next());
    else if (a === "--expect-version") opts.expectVersion = next();
    else if (a === "--json") opts.json = resolve(next());
    else throw new Error(`unknown argument ${a}`);
  }
  if (opts.variant !== "store" && opts.variant !== "full") throw new Error("--variant must be store or full");
  return opts;
}

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok: Boolean(ok), detail });
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && detail ? ` (${detail})` : ""}`);
  return Boolean(ok);
}

function buildExtension(variant) {
  const winkel = variant === "store";
  // A single command string, because Node refuses to start .cmd files without a shell and warns
  // when arguments are passed together with shell: true. pnpm is the repo's package manager.
  const run = spawnSync("pnpm build", {
    cwd: EXTENSION_PKG,
    env: { ...process.env, YAD_WINKEL: winkel ? "1" : "" },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: true,
  });
  if (run.status !== 0) {
    throw new Error(`build failed (exit ${run.status}): ${(run.stdout + run.stderr).slice(-600)}`);
  }
  return join(EXTENSION_PKG, winkel ? ".output-winkel" : ".output", "chrome-mv3");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Chrome derives the extension id from the public key: first 16 bytes of its SHA-256, a to p. */
function idFromKey(base64Key) {
  const digest = createHash("sha256").update(Buffer.from(base64Key, "base64")).digest().subarray(0, 16);
  return [...digest].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join("");
}

/** Static checks on the unpacked build. Returns the parsed manifest, or null when unusable. */
function staticChecks(dir, opts) {
  const manifestPath = join(dir, "manifest.json");
  if (!check("manifest.json exists", existsSync(manifestPath), manifestPath)) return null;
  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (e) {
    check("manifest.json is valid JSON", false, e.message);
    return null;
  }
  check("manifest.json is valid JSON", true);
  check("manifest_version is 3", manifest.manifest_version === 3, `got ${manifest.manifest_version}`);
  check("manifest has a name and a version", Boolean(manifest.name) && /^\d+(\.\d+){1,3}$/.test(String(manifest.version)), `${manifest.name} ${manifest.version}`);
  if (opts.expectVersion) check(`manifest version is ${opts.expectVersion}`, manifest.version === opts.expectVersion, `got ${manifest.version}`);

  const sw = manifest.background?.service_worker;
  check("manifest declares a background service_worker", typeof sw === "string" && sw.length > 0);
  if (typeof sw === "string") check(`service worker file ${sw} exists`, existsSync(join(dir, sw)));
  const panel = manifest.side_panel?.default_path;
  check("manifest declares a side panel page", typeof panel === "string" && panel.length > 0);
  if (typeof panel === "string") check(`side panel page ${panel} exists`, existsSync(join(dir, panel)));

  const referenced = new Set();
  for (const cs of manifest.content_scripts ?? []) for (const f of [...(cs.js ?? []), ...(cs.css ?? [])]) referenced.add(f);
  for (const f of Object.values(manifest.icons ?? {})) referenced.add(f);
  for (const f of Object.values(manifest.action?.default_icon ?? {})) referenced.add(f);
  const missing = [...referenced].filter((f) => !existsSync(join(dir, f)));
  check(`all ${referenced.size} files named by content scripts and icons exist`, missing.length === 0, `missing: ${missing.join(", ")}`);

  if (manifest.key) {
    const idFile = join(EXTENSION_PKG, ".keys", "ext-id.txt");
    if (existsSync(idFile)) {
      const expected = readFileSync(idFile, "utf8").trim();
      check("the manifest key gives the extension id recorded in .keys/ext-id.txt", idFromKey(manifest.key) === expected, `${idFromKey(manifest.key)} vs ${expected}`);
    }
  }

  const permissions = new Set(manifest.permissions ?? []);
  const hasDebuggerAndCookies = permissions.has("debugger") && permissions.has("cookies");
  if (opts.variant === "store") {
    check("store variant has neither debugger nor cookies permission", !permissions.has("debugger") && !permissions.has("cookies"), [...permissions].join(","));
  } else {
    check("full variant has the debugger and cookies permissions", hasDebuggerAndCookies, [...permissions].join(","));
  }

  if (opts.baseline) {
    const base = readJson(opts.baseline);
    for (const field of ["permissions", "host_permissions", "optional_permissions", "optional_host_permissions"]) {
      const before = new Set(base[field] ?? []);
      const after = new Set(manifest[field] ?? []);
      const added = [...after].filter((p) => !before.has(p));
      const removed = [...before].filter((p) => !after.has(p));
      check(`${field} unchanged against the baseline`, added.length === 0 && removed.length === 0, `added [${added}] removed [${removed}]`);
    }
    check("manifest_version unchanged against the baseline", manifest.manifest_version === base.manifest_version);
    check("name unchanged against the baseline", manifest.name === base.name, `${base.name} -> ${manifest.name}`);
  }
  return manifest;
}

/** A tiny page for the content script to work on. */
function startPageServer() {
  const html =
    "<!doctype html><html><head><title>Smoke page</title></head><body>" +
    "<h1>Smoke page</h1><button id=\"press\">Press me</button> <a href=\"#anchor\">A link</a> " +
    "<input aria-label=\"Your name\" /></body></html>";
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => resolveServer({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

/**
 * A dead service worker does not reject calls to it, it leaves them waiting. Every call that
 * goes through the worker therefore gets a deadline and turns into a failed check instead of a hang.
 */
function within(ms, promise) {
  let timer;
  const deadline = new Promise((resolveDeadline) => {
    timer = setTimeout(() => resolveDeadline({ timedOut: true }), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function collectPageProblems(page, label, bag) {
  const add = (kind, text) => bag.push({ where: label, kind, text: String(text).slice(0, 300) });
  page.on("console", (m) => {
    if (m.type() === "error") add("console.error", m.text());
  });
  page.on("pageerror", (e) => add("pageerror", e.message));
  page.on("requestfailed", (r) => add("requestfailed", `${r.url()} ${r.failure()?.errorText ?? ""}`));
  page.on("response", (r) => {
    if (r.status() >= 400) add("http " + r.status(), r.url());
  });
}

async function runtimeChecks(builtDir, manifest, opts, details) {
  const requireFromCompanion = createRequire(join(ROOT, "packages", "companion", "package.json"));
  const { chromium } = requireFromCompanion("playwright");
  const userDataDir = mkdtempSync(join(tmpdir(), "yad-extension-smoke-"));
  // The full variant carries a manifest key, which gives it the fixed extension id that a
  // registered native messaging host allows. Chromium reads the same Windows registry entries
  // as Chrome, so on a machine with Yad installed that id would start the real companion. The
  // run therefore loads a copy without the key (a random id, no host access); the key itself
  // is checked statically against the id in the extension's .keys folder.
  const dir = join(userDataDir, "extension");
  cpSync(builtDir, dir, { recursive: true });
  if (manifest.key) {
    const copy = readJson(join(dir, "manifest.json"));
    delete copy.key;
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(copy));
  }
  const { server, url: pageUrl } = await startPageServer();
  const problems = [];
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`, "--no-first-run", "--no-default-browser-check"],
    });

    context.on("weberror", (e) => problems.push({ where: "context", kind: "weberror", text: String(e.error()?.message ?? e.error()).slice(0, 300) }));
    context.on("console", (m) => {
      if (m.type() === "error" && !m.page()) problems.push({ where: "worker", kind: "console.error", text: m.text().slice(0, 300) });
    });

    // 2. Service worker.
    let worker = context.serviceWorkers()[0];
    if (!worker) {
      try {
        worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
      } catch {
        worker = undefined;
      }
    }
    if (!check("the service worker starts", Boolean(worker), "no service worker target within 15s")) return problems;
    const extensionId = new URL(worker.url()).host;
    details.extensionId = extensionId;
    details.serviceWorkerUrl = worker.url();
    check("service worker URL is the declared file", worker.url().endsWith("/" + manifest.background.service_worker), worker.url());

    const live = await within(10_000, worker.evaluate(() => {
      const m = chrome.runtime.getManifest();
      return {
        id: chrome.runtime.id,
        name: m.name,
        version: m.version,
        permissions: m.permissions,
        hasDebugger: typeof chrome.debugger !== "undefined",
        hasCookies: typeof chrome.cookies !== "undefined",
        hasSidePanel: typeof chrome.sidePanel !== "undefined",
      };
    }));
    details.liveManifest = live;
    if (!check("the service worker runs the extension code", !live.timedOut, "no answer within 10s")) return problems;
    check("the running extension reports the manifest from disk", live.name === manifest.name && live.version === manifest.version && JSON.stringify([...live.permissions].sort()) === JSON.stringify([...(manifest.permissions ?? [])].sort()));
    check(
      opts.variant === "store" ? "chrome.debugger and chrome.cookies are not available in the store variant" : "chrome.debugger and chrome.cookies are available in the full variant",
      opts.variant === "store" ? !live.hasDebugger && !live.hasCookies : live.hasDebugger && live.hasCookies,
      `debugger ${live.hasDebugger}, cookies ${live.hasCookies}`,
    );
    check("chrome.sidePanel is available", live.hasSidePanel);

    // 3. Extension pages.
    const base = `chrome-extension://${extensionId}/`;
    const panelPage = await context.newPage();
    collectPageProblems(panelPage, "sidepanel", problems);
    await panelPage.goto(base + manifest.side_panel.default_path, { waitUntil: "load", timeout: 20_000 });
    await panelPage.waitForTimeout(1500);
    const panel = await panelPage.evaluate(() => ({ title: document.title, textLength: (document.body?.innerText ?? "").trim().length, elements: document.body?.querySelectorAll("*").length ?? 0 }));
    details.sidePanel = panel;
    check("side panel page renders content", panel.textLength > 0 && panel.elements > 10, JSON.stringify(panel));
    const status = await within(10_000, panelPage.evaluate(() => chrome.runtime.sendMessage({ type: "YAD_GET_STATUS" }).then((r) => r ?? null, (e) => ({ error: String(e) }))));
    details.status = status;
    check("the service worker answers YAD_GET_STATUS from the side panel", Boolean(status) && typeof status.status === "string", JSON.stringify(status));

    const legalDir = join(dir, "legal");
    const legalFiles = existsSync(legalDir) ? readdirSync(legalDir).filter((f) => f.endsWith(".html")).sort() : [];
    check("the legal pages are packaged", legalFiles.length > 0, legalDir);
    for (const file of legalFiles) {
      const page = await context.newPage();
      collectPageProblems(page, "legal/" + file, problems);
      await page.goto(base + "legal/" + file, { waitUntil: "load", timeout: 20_000 });
      const text = await page.evaluate(() => ({ title: document.title, length: (document.body?.innerText ?? "").trim().length }));
      check(`legal/${file} opens with text`, text.length > 200 && text.title.length > 0, JSON.stringify(text));
      await page.close();
    }

    // 4. Content script on an ordinary page.
    const webPage = await context.newPage();
    collectPageProblems(webPage, "web page", problems);
    await webPage.goto(pageUrl, { waitUntil: "load" });
    await webPage.waitForTimeout(500);
    const tabReply = async (message) =>
      within(10_000, panelPage.evaluate(async ([url, msg]) => {
        const tabs = await chrome.tabs.query({ url: url + "*" });
        if (!tabs[0]?.id) return { noTab: true };
        try {
          return await chrome.tabs.sendMessage(tabs[0].id, msg);
        } catch (e) {
          return { error: String(e) };
        }
      }, [pageUrl, message]));
    const ping = await tabReply({ type: "YAD_PING" });
    check("the content script answers YAD_PING", ping?.ok === true, JSON.stringify(ping));
    const snapshot = await tabReply({ type: "YAD_SNAPSHOT" });
    const names = (snapshot?.nodes ?? []).map((n) => `${n.role}:${n.name}`);
    details.snapshotNodes = names;
    check("the content script returns a snapshot of the page", snapshot?.title === "Smoke page" && names.some((n) => /button:Press me/.test(n)) && names.some((n) => /link:A link/.test(n)), JSON.stringify(names));
    const trap = await webPage.evaluate(() => ({ installed: window.__yadDialoogVangnet === true, confirmResult: window.confirm("smoke"), recorded: (window.__yadDialogen ?? []).length }));
    check("the main-world dialog trap is installed and cancels confirm()", trap.installed && trap.confirmResult === false && trap.recorded === 1, JSON.stringify(trap));

    await webPage.close();
    await panelPage.close();
  } finally {
    if (context) await context.close().catch(() => {});
    await new Promise((r) => server.close(r));
    rmSync(userDataDir, { recursive: true, force: true });
  }
  return problems;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // Last line of defence against a hang that no single deadline covers.
  setTimeout(() => {
    console.error("FAIL the smoke test did not finish within 120s");
    process.exit(1);
  }, 120_000).unref();
  const details = { variant: opts.variant };
  let dir = opts.dir;
  if (!dir) {
    dir = buildExtension(opts.variant);
    if (!opts.expectVersion) opts.expectVersion = readJson(join(EXTENSION_PKG, "package.json")).version;
  }
  details.dir = dir;
  console.log(`Testing ${dir} (${opts.variant} variant)`);

  const manifest = staticChecks(dir, opts);
  const staticFailed = results.some((r) => !r.ok);
  if (!manifest || staticFailed) {
    console.log("Static checks failed, the browser is not started.");
  } else {
    let problems = [];
    try {
      problems = await runtimeChecks(dir, manifest, opts, details);
    } catch (e) {
      check("the browser run completes", false, e.message);
    }
    details.problems = problems;
    check("no console errors, page errors, failed requests or error responses", problems.length === 0, problems.map((p) => `${p.where} ${p.kind}: ${p.text}`).join(" | "));
  }

  const failed = results.filter((r) => !r.ok);
  details.results = results;
  if (opts.json) writeFileSync(opts.json, JSON.stringify(details, null, 2));
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`FAIL extension smoke test crashed: ${e.stack ?? e.message}`);
  process.exit(1);
});
