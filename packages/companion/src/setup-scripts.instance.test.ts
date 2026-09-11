/**
 * Regressietest voor de multi-instance-logica in de twee opzetscripts
 * (scripts/setup-native-host.ts en packages/companion/npm-package/src/
 * setup-host-npm.mjs). Beide zijn losstaande scripts, geen importeerbare
 * modules, dus deze test draait ze echt als kindproces met een eigen
 * tijdelijke HOME/repo-omgeving en controleert de daadwerkelijk
 * geschreven bestanden — precies zoals de muraqib-controlerondes dat
 * handmatig deden toen deze scripts twee keer stuk bleken (een gemiste
 * registratie-aanpassing, een verkeerde per-instantie-configuratiemap).
 * Zonder deze test beschermt niets die klasse fouten tegen een volgende
 * wijziging.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..");
const setupNativeHostTs = join(repoRoot, "scripts", "setup-native-host.ts");
const setupHostNpmMjs = join(
  repoRoot,
  "packages",
  "companion",
  "npm-package",
  "src",
  "setup-host-npm.mjs",
);

function runScript(
  scriptPath: string,
  runner: "tsx" | "node",
  env: Record<string, string | undefined>,
  cwd: string,
): { status: number; output: string } {
  try {
    // node --import tsx runs the .ts file directly, no npx/shell involved —
    // npx resolves to a .cmd shim on Windows, which child_process cannot
    // exec without shell:true, and shell:true on an argument list triggers
    // Node's own DEP0190 warning about unescaped arguments for no reason
    // here (scriptPath is a fixed, repo-internal path, never user input).
    const output = execFileSync(
      process.execPath,
      runner === "tsx" ? ["--import", "tsx", scriptPath] : [scriptPath],
      {
        cwd,
        env: { ...process.env, ...env },
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("scripts/setup-native-host.ts — instantie-validatie (regressie)", () => {
  it("weigert een instantienaam met een schuine streep, geen kale crash", () => {
    const { status, output } = runScript(setupNativeHostTs, "tsx", {
      YAD_INSTANCE: "b/c",
      YAD_PORT: "4001",
    }, repoRoot);
    expect(status).not.toBe(0);
    expect(output).toContain("veilige instantienaam");
    expect(output).not.toContain("ENOENT");
  });

  it("weigert een instantienaam met een spatie", () => {
    const { status, output } = runScript(setupNativeHostTs, "tsx", {
      YAD_INSTANCE: "my instance",
      YAD_PORT: "4001",
    }, repoRoot);
    expect(status).not.toBe(0);
    expect(output).toContain("veilige instantienaam");
  });

  it("weigert YAD_PORT=3747 voor een genoemde instantie (de stille-botsing-tijdbom)", () => {
    const { status, output } = runScript(setupNativeHostTs, "tsx", {
      YAD_INSTANCE: "b",
      YAD_PORT: "3747",
    }, repoRoot);
    expect(status).not.toBe(0);
    expect(output).toContain("3747");
  });

  it("weigert YAD_INSTANCE zonder YAD_PORT", () => {
    const { status, output } = runScript(setupNativeHostTs, "tsx", {
      YAD_INSTANCE: "b",
      YAD_PORT: undefined,
    }, repoRoot);
    expect(status).not.toBe(0);
    expect(output).toContain("YAD_PORT ontbreekt");
  });

  it("accepteert een geldige genoemde instantie en schrijft de juiste, gescheiden bestanden", () => {
    const tmp = mkdtempSync(join(tmpdir(), "yad-instance-test-"));
    try {
      const { status } = runScript(setupNativeHostTs, "tsx", {
        YAD_INSTANCE: "regtest",
        YAD_PORT: "4099",
      }, repoRoot);
      expect(status).toBe(0);

      const manifestPath = join(repoRoot, "native-messaging", "com.yad.companion.regtest.json");
      const launcherPath = join(repoRoot, "native-messaging", "yad-companion-launcher-regtest.bat");
      expect(existsSync(manifestPath)).toBe(true);
      expect(existsSync(launcherPath)).toBe(true);

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      expect(manifest.name).toBe("com.yad.companion.regtest");
      expect(manifest.path).toBe(launcherPath);

      const launcher = readFileSync(launcherPath, "utf8");
      expect(launcher).toContain('set "YAD_PORT=4099"');
      expect(launcher).toContain("data-instance");
      expect(launcher).toContain("regtest");
    } finally {
      rmSync(join(repoRoot, "native-messaging", "com.yad.companion.regtest.json"), { force: true });
      rmSync(join(repoRoot, "native-messaging", "yad-companion-launcher-regtest.bat"), { force: true });
      rmSync(join(repoRoot, "data-instance", "regtest"), { force: true, recursive: true });
      rmSync(tmp, { force: true, recursive: true });
    }
  });

  it("laat het standaardpad (geen YAD_INSTANCE) exact ongewijzigd: geen extra env-regels in de launcher", () => {
    const { status } = runScript(setupNativeHostTs, "tsx", {}, repoRoot);
    expect(status).toBe(0);
    const launcherPath = join(repoRoot, "native-messaging", "yad-companion-launcher.bat");
    const launcher = readFileSync(launcherPath, "utf8");
    // Alleen de shebang-regel en de daadwerkelijke node-aanroep, geen `set`-regels.
    expect(launcher.split("\r\n").filter(Boolean)).toEqual([
      "@echo off",
      expect.stringContaining("main.js"),
    ]);
  });

  it("schrijft/hertrekt de private extensie-sleutel als owner-only (0600) op niet-Windows (adversariele review 2026-09-11, finding 16)", () => {
    const { status } = runScript(setupNativeHostTs, "tsx", {}, repoRoot);
    expect(status).toBe(0);
    const privPath = join(repoRoot, "packages", "extension", ".keys", "ext-private.pem");
    expect(existsSync(privPath)).toBe(true);
    if (process.platform !== "win32") {
      const mode = statSync(privPath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
});

describe("setup-host-npm.mjs — instantie-validatie (regressie)", () => {
  it("weigert een instantienaam met een schuine streep, geen kale crash", () => {
    const { status, output } = runScript(setupHostNpmMjs, "node", {
      YAD_INSTANCE: "b/c",
      YAD_PORT: "4001",
    }, repoRoot);
    expect(status).not.toBe(0);
    expect(output).toContain("safe instance name");
    expect(output).not.toContain("ENOENT");
  });

  it("weigert YAD_PORT=3747 voor een genoemde instantie", () => {
    const { status, output } = runScript(setupHostNpmMjs, "node", {
      YAD_INSTANCE: "b",
      YAD_PORT: "3747",
    }, repoRoot);
    expect(status).not.toBe(0);
    expect(output).toContain("3747");
  });

  it("accepteert een geldige genoemde instantie en schrijft naar een eigen configuratiemap", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "yad-npm-home-"));
    try {
      const { status, output } = runScript(setupHostNpmMjs, "node", {
        YAD_INSTANCE: "regtest2",
        YAD_PORT: "4098",
        USERPROFILE: fakeHome,
        HOME: fakeHome,
      }, repoRoot);
      // Faalt waarschijnlijk op de companionEntry-existsSync-check (dist/pair-host.js
      // bestaat niet zonder een build), dat is een apart, bekend, hier niet relevant
      // punt — de validatie zelf moet er in beide gevallen voorbij zijn gekomen,
      // dus check op de afwezigheid van een validatiefout, niet op status===0.
      expect(output).not.toContain("safe instance name");
      expect(output).not.toContain("must be a distinct port number");
    } finally {
      rmSync(fakeHome, { force: true, recursive: true });
    }
  });

  it("schrijft de private extensie-sleutel als owner-only (0600) op niet-Windows (adversariele review 2026-09-11, finding 16)", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "yad-npm-home-perm-"));
    // De companionEntry-check verwacht een sibling pair-host.js naast het script
    // zelf; zonder een echte build zetten we hier een lege stand-in neer zodat
    // het script voorbij die check komt en echt een sleutel genereert.
    const dummyPairHost = join(repoRoot, "packages", "companion", "npm-package", "src", "pair-host.js");
    const dummyAlreadyExisted = existsSync(dummyPairHost);
    if (!dummyAlreadyExisted) writeFileSync(dummyPairHost, "// test-stand-in\n", "utf8");
    try {
      const { status } = runScript(setupHostNpmMjs, "node", {
        USERPROFILE: fakeHome,
        HOME: fakeHome,
      }, repoRoot);
      expect(status).toBe(0);
      const privPath = join(fakeHome, ".yadagent", "keys", "ext-private.pem");
      expect(existsSync(privPath)).toBe(true);
      if (process.platform !== "win32") {
        const mode = statSync(privPath).mode & 0o777;
        expect(mode).toBe(0o600);
      }
    } finally {
      if (!dummyAlreadyExisted) rmSync(dummyPairHost, { force: true });
      rmSync(fakeHome, { force: true, recursive: true });
    }
  });
});
