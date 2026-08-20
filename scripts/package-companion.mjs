/**
 * Bundelt het Brein (companion) tot één zelfstandig .cjs-bestand.
 *
 * Waarom: de losse download voor niet-ontwikkelaars mag geen node_modules of
 * workspace-symlinks vereisen. esbuild inlinet @yad/shared en alle lokale modules
 * in één bestand. playwright blijft extern — de lichte companion (main.js) raakt
 * het niet, en meesleuren zou de download onnodig zwaar maken.
 *
 * Draai: node scripts/package-companion.mjs
 * Uitvoer: companion-dist/yad-companion-bundle.cjs
 */
import { readdirSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

// esbuild uit de pnpm-store laden (staat niet in .bin, wel in de store).
const pnpmDir = resolve(root, "node_modules", ".pnpm");
const esbuildPkg = readdirSync(pnpmDir).find((d) => /^esbuild@\d/.test(d));
if (!esbuildPkg) {
  console.error("esbuild niet gevonden in node_modules/.pnpm");
  process.exit(1);
}
const esbuildMain = resolve(pnpmDir, esbuildPkg, "node_modules", "esbuild", "lib", "main.js");
const { build, analyzeMetafile } = await import(pathToFileURL(esbuildMain).href);
console.log("esbuild:", esbuildPkg);

const entry = resolve(root, "packages", "companion", "dist", "main.js");
const outDir = resolve(root, "companion-dist");
mkdirSync(outDir, { recursive: true });
const outfile = resolve(outDir, "yad-companion-bundle.cjs");

const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile,
  // playwright wordt niet door de lichte companion gebruikt; extern houden.
  // Mocht de bundel het tóch binnentrekken, dan zien we dat aan de metafile.
  external: ["playwright", "playwright-core"],
  metafile: true,
  logLevel: "warning",
});

// Controle: zit playwright per ongeluk tóch in de graaf?
const inputs = Object.keys(result.metafile.inputs);
const raaktPlaywright = inputs.some((p) => /playwright/i.test(p));
const size = statSync(outfile).size;

console.log("");
console.log("Bundel     :", outfile);
console.log("Grootte    :", (size / 1024).toFixed(1), "KB");
console.log("Modules    :", inputs.length);
console.log("Playwright in graaf:", raaktPlaywright ? "JA (probleem)" : "nee (goed)");
console.log(await analyzeMetafile(result.metafile, { verbose: false }));
