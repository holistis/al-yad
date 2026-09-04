#!/usr/bin/env node
/**
 * yadagent: Part B of Yad, the companion. Two ways to run it, because it has
 * two genuinely different modes, not one CLI trying to hide that.
 *
 *   yadagent pair    pairs with the Yad Chrome extension (Part A), so it
 *                     drives your own real, logged-in browser. Native
 *                     messaging, Windows only for now.
 *
 *   yadagent serve    a standalone HTTP automation server, no extension, no
 *                     paired browser session. Headless Chromium via
 *                     Playwright, your own Ollama instance for the model.
 *                     Works on any OS Node and Playwright support.
 *
 * These are not interchangeable. `pair` gives you your actual browser, with
 * your actual logins, the way the rest of Yad's docs describe it. `serve`
 * gives you a fresh, empty browser every run, no logins carried over. Picking
 * the wrong one for what you actually want is a worse experience than reading
 * one extra paragraph first, so this file's whole job is making sure nobody
 * has to guess which mode they are getting.
 */
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "dist");

function help() {
  console.log(`yadagent, Part B of Yad (the companion)

  npx yadagent pair
      Set up native messaging so this companion can pair with the Yad Chrome
      extension (Part A) and drive your own real, logged-in browser.
      Windows only today. Get the extension itself from the Chrome Web Store,
      this command only sets up the local half of the pairing.

  npx yadagent serve
      Run a standalone automation server, no browser extension involved.
      Headless Chromium via Playwright, no carried-over logins, your own
      Ollama instance for the model. Cross-platform.
      Requires OLLAMA_BASE_URL to be set (e.g. http://localhost:11434).
      Optional: OLLAMA_MODEL, YAD_PORT (default 3747), YAD_HOST (default 0.0.0.0).

Part A (the extension) and Part B (this package) are two separate things you
install separately. This package is Part B only.

https://github.com/holistis/al-yad`);
}

function runNode(scriptPath, args) {
  const child = spawn(process.execPath, [scriptPath, ...args], { stdio: "inherit" });
  child.on("exit", code => process.exit(code ?? 1));
  child.on("error", err => {
    console.error(`Could not start ${scriptPath}: ${err.message}`);
    process.exit(1);
  });
}

function pair(args) {
  const setupHost = join(DIST, "setup-host.js");
  if (!existsSync(setupHost)) {
    console.error("setup-host.js is missing from this package's dist folder. This is a packaging bug, not something you did wrong.");
    process.exit(1);
  }

  console.log("Step 1: generating a stable extension key and the native-messaging host manifest...\n");
  const setup = spawn(process.execPath, [setupHost], { stdio: "inherit" });
  setup.on("error", err => {
    console.error(`Could not run setup-host.js: ${err.message}`);
    process.exit(1);
  });
  setup.on("exit", code => {
    if (code !== 0) process.exit(code ?? 1);

    if (platform() !== "win32") {
      console.log(
        "\nStep 2, registering the host with your browser, is Windows only today. macOS and Linux support is tracked as an open task in this project's CONTRIBUTING.md, not silently unsupported. The manifest above was still generated correctly and is ready for whenever that registration step exists for your OS."
      );
      return;
    }

    console.log("\nStep 2: registering the host in the Windows registry (current user only, no admin needed)...\n");
    const registerScript = join(DIST, "register-host.ps1");
    const register = spawn("powershell", ["-ExecutionPolicy", "Bypass", "-File", registerScript], { stdio: "inherit" });
    register.on("error", err => {
      console.error(`Could not run register-host.ps1: ${err.message}`);
      process.exit(1);
    });
    register.on("exit", code2 => process.exit(code2 ?? 1));
  });
}

function serve(args) {
  if (!process.env.OLLAMA_BASE_URL) {
    console.error(
      "OLLAMA_BASE_URL is not set. This mode talks to your own Ollama instance for the model, so it needs to know where that is, e.g. OLLAMA_BASE_URL=http://localhost:11434. Refusing to start rather than failing confusingly on the first request."
    );
    process.exit(1);
  }
  runNode(join(DIST, "serve.js"), args);
}

const [, , command, ...rest] = process.argv;

if (command === "pair") pair(rest);
else if (command === "serve") serve(rest);
else if (command === "--help" || command === "-h" || !command) help();
else {
  console.error(`Unknown command "${command}". Run "npx yadagent --help".`);
  process.exit(1);
}
