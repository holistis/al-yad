/**
 * Bouwt de losse Companion-.exe (Weg B): één bestand dat de gebruiker dubbelklikt.
 *
 *   1. esbuild bundelt packages/companion/dist/exe-entry.js -> companion-dist/yad-companion-exe-bundle.cjs
 *      (playwright blijft extern; het lichte brein raakt het niet)
 *   2. Node SEA maakt een blob van die bundel
 *   3. node.exe wordt gekopieerd naar dist-exe/YAD-Setup.exe en de blob geinjecteerd (postject)
 *
 * Vereist eerst: pnpm --filter @yad/companion build   (tsc, zodat dist/exe-entry.js bestaat)
 * Draai:         node scripts/build-exe.mjs
 */
import { readdirSync, mkdirSync, writeFileSync, copyFileSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = process.cwd();

// --- 1. esbuild-bundel ---
const pnpmDir = resolve(root, "node_modules", ".pnpm");
const esbuildPkg = readdirSync(pnpmDir).find((d) => /^esbuild@\d/.test(d));
if (!esbuildPkg) {
  console.error("esbuild niet gevonden in node_modules/.pnpm");
  process.exit(1);
}
const esbuildMain = resolve(pnpmDir, esbuildPkg, "node_modules", "esbuild", "lib", "main.js");
const { build } = await import(pathToFileURL(esbuildMain).href);

const entry = resolve(root, "packages", "companion", "dist", "exe-entry.js");
if (!existsSync(entry)) {
  console.error("dist/exe-entry.js ontbreekt — draai eerst: pnpm --filter @yad/companion build");
  process.exit(1);
}
const outDir = resolve(root, "companion-dist");
mkdirSync(outDir, { recursive: true });
const bundle = resolve(outDir, "yad-companion-exe-bundle.cjs");
await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: bundle,
  external: ["playwright", "playwright-core"],
  logLevel: "warning",
});
console.log("bundel:", (statSync(bundle).size / 1024).toFixed(1), "KB");

// --- 2. SEA-blob ---
const distExe = resolve(root, "dist-exe");
mkdirSync(distExe, { recursive: true });
const seaConfig = resolve(distExe, "sea-config.json");
const blob = resolve(distExe, "yad-sea.blob");
writeFileSync(
  seaConfig,
  JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }, null, 2),
);
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });
console.log("blob:", (statSync(blob).size / 1024).toFixed(1), "KB");

// --- 3. node.exe kopieren + blob injecteren ---
const exe = resolve(distExe, "YAD-Setup.exe");
copyFileSync(process.execPath, exe);
const fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
execFileSync(
  "npx",
  ["--yes", "postject", exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", fuse],
  { stdio: "inherit", shell: true },
);

console.log("");
console.log("KLAAR:", exe, "(" + (statSync(exe).size / 1024 / 1024).toFixed(1) + " MB)");
