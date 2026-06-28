/**
 * Licentie-poort (verkoop-kritisch): faalt de build bij elke AGPL/GPL-dependency
 * en waarschuwt bij onbekende/niet-permissieve licenties. Zie LICENSES.md.
 *
 * Draai: pnpm check-licenses
 */
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const ALLOW = new Set([
  "MIT",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  "CC-BY-4.0",
  "MPL-2.0",
  "Zlib",
]);

/** Sterke copyleft die verkoop blokkeert: (A)GPL, maar NIET LGPL (link-veilig). */
function hasForbiddenToken(s: string): boolean {
  if (/AGPL/i.test(s)) return true;
  if (/\bGPL\b/i.test(s) && !/LGPL/i.test(s)) return true;
  return false;
}

function isPermissiveToken(tok: string): boolean {
  const t = tok.trim().replace(/[()]/g, "");
  if (ALLOW.has(t)) return true;
  if (/^BSD/i.test(t)) return true; // BSD, BSD-2-Clause, BSD-3-Clause
  if (/^Zlib$/i.test(t)) return true;
  if (/^WTFPL$/i.test(t)) return true;
  return false;
}

/**
 * SPDX-bewust: `MIT OR GPL-3.0` is oke (we kiezen MIT). Alleen falen als ELKE
 * OR-tak copyleft is, of een enkele/AND-expressie (A)GPL bevat.
 */
function classify(license: string): "ok" | "fail" | "unknown" {
  const expr = license.trim();
  if (/\bOR\b/i.test(expr)) {
    const branches = expr.replace(/[()]/g, "").split(/\bOR\b/i);
    // Als er een schone tak bestaat, kunnen we die kiezen -> oke.
    if (branches.some((b) => !hasForbiddenToken(b))) return "ok";
    return "fail";
  }
  if (hasForbiddenToken(expr)) return "fail";
  const tokens = expr
    .replace(/[()]/g, "")
    .split(/\bAND\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return tokens.every(isPermissiveToken) ? "ok" : "unknown";
}

interface PkgEntry {
  name?: string;
  versions?: string[];
  version?: string;
}

let raw = "";
try {
  raw = execSync("pnpm licenses list --json", {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch (err) {
  const e = err as { stdout?: Buffer | string };
  raw = (e.stdout ?? "").toString();
}

let data: Record<string, PkgEntry[]>;
try {
  data = JSON.parse(raw) as Record<string, PkgEntry[]>;
} catch {
  console.error("Kon `pnpm licenses list --json` niet parsen. Output:\n", raw.slice(0, 500));
  process.exit(2);
}

const failures: string[] = [];
const unknowns: string[] = [];

for (const [license, pkgs] of Object.entries(data)) {
  const names = (pkgs ?? [])
    .map((p) => `${p.name ?? "?"}@${p.version ?? (p.versions ?? []).join("/")}`)
    .join(", ");
  const verdict = classify(license);
  if (verdict === "fail") {
    failures.push(`[VERBODEN] ${license}: ${names}`);
  } else if (verdict === "unknown") {
    unknowns.push(`[ONBEKEND] ${license}: ${names}`);
  }
}

if (unknowns.length > 0) {
  console.warn("Niet op de allowlist (handmatig beoordelen):");
  for (const u of unknowns) console.warn("  " + u);
}

if (failures.length > 0) {
  console.error("\nLICENTIE-POORT GEFAALD — copyleft gevonden die verkoop blokkeert:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

console.log(
  `Licentie-poort OK. ${Object.keys(data).length} licentie-soorten, 0 verboden, ${unknowns.length} ter beoordeling.`,
);
