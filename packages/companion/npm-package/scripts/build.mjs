#!/usr/bin/env node
/**
 * Builds the two entry points this package ships, each as a single
 * self-contained file with @yad/shared inlined.
 *
 * Why bundle instead of just running tsc: the companion imports @yad/shared
 * via `workspace:*`, a pnpm-workspace link that only resolves inside this
 * monorepo. Outside it, `npx yadagent` would fail on the first import.
 * Bundling everything into one file per entry means there is no runtime
 * dependency resolution left to get wrong, which is also why `playwright`
 * stays external rather than bundled: it ships its own native browser
 * binaries via a postinstall step, and bundling it would strip that away.
 */
import { build } from "esbuild";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, "..");
const COMPANION_ROOT = join(PKG_ROOT, "..");
const OUT_DIR = join(PKG_ROOT, "dist");

const ENTRIES = [
  { in: join(COMPANION_ROOT, "src/main.ts"), out: "pair-host.js", label: "native-messaging companion (pair)" },
  { in: join(COMPANION_ROOT, "src/main-server.ts"), out: "serve.js", label: "standalone Playwright server (serve)" },
];

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  for (const entry of ENTRIES) {
    console.log(`Bundling ${entry.label}...`);
    await build({
      entryPoints: [entry.in],
      outfile: join(OUT_DIR, entry.out),
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      // playwright ships native browser binaries via its own postinstall,
      // bundling it would strip that mechanism away. Node built-ins are
      // external by default under platform: "node".
      external: ["playwright"],
      banner: { js: "// Bundled by yadagent's build step. Do not edit directly, edit the source in packages/companion/src instead." },
      logLevel: "info",
    });
  }

  // Deliberately the npm-package specific variants (src/setup-host-npm.mjs,
  // src/register-host-npm.ps1), not the monorepo's scripts/setup-native-host.ts
  // and scripts/register-host.ps1. Those two compute paths relative to a
  // monorepo layout that does not exist once this runs from an installed npm
  // package: verified live, the unmodified version put the extension key and
  // the host manifest inside this package's own install directory, which a
  // package reinstall would silently wipe and regenerate, changing the
  // extension ID and breaking pairing with an already-installed extension
  // with no visible error. See the comments in setup-host-npm.mjs.
  const setupHostSrc = join(PKG_ROOT, "src", "setup-host-npm.mjs");
  if (existsSync(setupHostSrc)) {
    console.log("Bundling native-host setup script...");
    await build({
      entryPoints: [setupHostSrc],
      outfile: join(OUT_DIR, "setup-host.js"),
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      logLevel: "info",
    });
  } else {
    console.error(`Expected to find ${setupHostSrc}, did not. Aborting so a stale or missing setup script is not silently shipped.`);
    process.exit(1);
  }

  const registerHostSrc = join(PKG_ROOT, "src", "register-host-npm.ps1");
  if (existsSync(registerHostSrc)) {
    copyFileSync(registerHostSrc, join(OUT_DIR, "register-host.ps1"));
  } else {
    console.error(`Expected to find ${registerHostSrc}, did not. Aborting.`);
    process.exit(1);
  }

  console.log("\nDone. Output in", OUT_DIR);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
