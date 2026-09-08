/**
 * Genereert een stabiele extensie-sleutel (zodat de extensie-ID vast staat),
 * leidt daaruit de extensie-ID af, en schrijft het native-messaging host-manifest
 * + een Windows-launcher die het Brein (companion) start.
 *
 * Waarom een vaste sleutel: Chrome leidt de extensie-ID af uit het publieke deel
 * van de "key" in het manifest. Zonder vaste sleutel verandert de ID per machine,
 * en dan klopt `allowed_origins` in het host-manifest niet meer. Dit script maakt
 * dat reproduceerbaar.
 *
 * Draai: pnpm setup-host   (na een companion-build)
 *
 * Multi-instance (2026-09-08): `YAD_INSTANCE=b YAD_PORT=4001 pnpm setup-host`
 * registreert een TWEEDE, onafhankelijke host naast de standaard-instantie
 * (eigen hostnaam, eigen poort, eigen logbestanden), zodat een tweede
 * Chrome-profiel er los van kan pairen zonder de eerste te storen. Beide
 * instanties delen bewust dezelfde extensie-sleutel (zelfde `.keys`-map,
 * dus zelfde extensie-ID) — het tweede profiel gebruikt dezelfde
 * extensie-build, alleen met een andere `nativeHostName` in de
 * extensie-instellingen. Zonder YAD_INSTANCE verandert er niets aan het
 * bestaande gedrag.
 */
import {
  generateKeyPairSync,
  createHash,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const extDir = resolve(repoRoot, "packages", "extension");
const keysDir = resolve(extDir, ".keys");
const nmDir = resolve(repoRoot, "native-messaging");
const companionEntry = resolve(repoRoot, "packages", "companion", "dist", "main.js");

const instance = (process.env["YAD_INSTANCE"] ?? "").trim();
const instancePort = process.env["YAD_PORT"];
if (instance && !instancePort) {
  console.error(
    `YAD_INSTANCE is "${instance}" maar YAD_PORT ontbreekt. Een tweede instantie heeft een eigen, vrije ` +
    `poort nodig (niet 3747, dat is de standaard-instantie). Voorbeeld: YAD_INSTANCE=${instance} YAD_PORT=4001 pnpm setup-host`
  );
  process.exit(1);
}

const HOST_NAME = instance ? `com.yad.companion.${instance}` : "com.yad.companion";
const instanceDataDir = instance ? resolve(repoRoot, "data-instance", instance) : undefined;

mkdirSync(keysDir, { recursive: true });
mkdirSync(nmDir, { recursive: true });
if (instanceDataDir) mkdirSync(instanceDataDir, { recursive: true });

// 1. Sleutel: hergebruik bestaande private key, anders nieuwe genereren.
const privPath = resolve(keysDir, "ext-private.pem");
let publicDer: Buffer;
if (existsSync(privPath)) {
  const privPem = readFileSync(privPath, "utf8");
  const keyObj = createPrivateKey(privPem);
  publicDer = createPublicKey(keyObj).export({ type: "spki", format: "der" }) as Buffer;
  console.log("Bestaande extensie-sleutel hergebruikt.");
} else {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  publicDer = publicKey as Buffer;
  writeFileSync(privPath, privateKey as string, "utf8");
  console.log("Nieuwe extensie-sleutel gegenereerd.");
}

// 2. manifest "key" = base64 van de DER public key.
const manifestKey = publicDer.toString("base64");

// 3. extensie-ID = eerste 16 bytes van sha256(publicDer), hex, met 0-f -> a-p.
const hashHex = createHash("sha256").update(publicDer).digest("hex").slice(0, 32);
const extId = [...hashHex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");

// 4. Schrijf de (publieke) afgeleiden weg voor reproduceerbaarheid.
writeFileSync(resolve(keysDir, "manifest-key.txt"), manifestKey, "utf8");
writeFileSync(resolve(keysDir, "ext-id.txt"), extId, "utf8");

// 5. Windows-launcher: Chrome native-messaging "path" mag geen argumenten dragen,
//    dus we wrappen `node <companion>` in een .bat.
//
// Voor een genoemde instantie (YAD_INSTANCE gezet): eigen launcher-bestandsnaam
// (anders overschrijft de tweede registratie de launcher van de eerste), en
// expliciete env-vars zodat deze instantie niet de C:\Code\yad-*.json-bestanden
// van de standaard-instantie deelt of de poort 3747 probeert te claimen.
const launcherPath = resolve(nmDir, instance ? `yad-companion-launcher-${instance}.bat` : "yad-companion-launcher.bat");
// Gebruik het absolute pad naar node.exe zodat Chrome de host kan starten
// ook als Node.js niet in de systeem-PATH staat (Chrome erft PATH niet altijd).
const nodeBin = process.execPath.replace(/"/g, '""');
const launcherLines = ["@echo off"];
if (instance && instanceDataDir) {
  launcherLines.push(
    `set "YAD_PORT=${instancePort}"`,
    `set "YAD_DATA_DIR=${instanceDataDir}"`,
    `set "YAD_STEP_LOG_PATH=${resolve(instanceDataDir, "yad-step-log.jsonl")}"`,
    `set "YAD_RESULT_PATH=${resolve(instanceDataDir, "yad-goal-result.json")}"`,
    `set "YAD_STUCK_PATH=${resolve(instanceDataDir, "yad-stuck.json")}"`,
    `set "YAD_BRIDGE_PATH=${resolve(instanceDataDir, "yad-claude-bridge.json")}"`
  );
}
launcherLines.push(`"${nodeBin}" "${companionEntry}" %*`, "");
const launcher = launcherLines.join("\r\n");
writeFileSync(launcherPath, launcher, "utf8");

// 6. Host-manifest met allowed_origins.
//
// Meerdere ID's, niet één. De lokaal afgeleide ID hoort erbij voor ontwikkelwerk, maar
// zodra de extensie uit een winkel komt is de ID een andere, en Chrome en Edge geven elk
// hun eigen. Stond hier alleen de lokale ID, dan werkt de geïnstalleerde extensie bij een
// klant gewoon niet: de browser weigert de verbinding met het Brein zonder zichtbare
// fout, en de gebruiker ziet alleen dat er niets gebeurt.
//
// Winkel-ID's toevoegen zodra ze bekend zijn:
//   YAD_EXTRA_EXT_IDS=abc...,def... pnpm setup-host
// of vul WINKEL_IDS hieronder in, dan zit het in de uitgeleverde installatie.
const WINKEL_IDS: string[] = [
  "dacfhekkemkiikecbjffmbdcohddodea", // Chrome Web Store (ingediend 2026-08-20)
  // "…", // Edge Add-ons, invullen na publicatie
];

const extraIds = (process.env["YAD_EXTRA_EXT_IDS"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Edge is ook Chromium en gebruikt dezelfde chrome-extension://-vorm, dus één schema volstaat.
const alleIds = [...new Set([extId, ...WINKEL_IDS, ...extraIds])];

const hostManifest = {
  name: HOST_NAME,
  description: "Yad companion (het Brein) native messaging host",
  path: launcherPath,
  type: "stdio",
  allowed_origins: alleIds.map((id) => `chrome-extension://${id}/`),
};
const hostManifestPath = resolve(nmDir, `${HOST_NAME}.json`);
writeFileSync(hostManifestPath, JSON.stringify(hostManifest, null, 2) + "\n", "utf8");

console.log("");
console.log("Extensie-ID      :", extId);
console.log("Toegestane ID's  :", alleIds.length === 1 ? "alleen de lokale" : alleIds.join(", "));
console.log("manifest key     :", manifestKey.slice(0, 32) + "...");
console.log("Host-manifest    :", hostManifestPath);
console.log("Launcher         :", launcherPath);
console.log("Companion-entry  :", companionEntry);
console.log("");
console.log("Volgende stap: registreer de host -> pnpm register-host (PowerShell).");
