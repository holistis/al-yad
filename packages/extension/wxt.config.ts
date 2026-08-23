import { defineConfig } from "wxt";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Vaste extensie-sleutel (publiek deel) zodat de extensie-ID vast staat en
// overeenkomt met allowed_origins in het geregistreerde host-manifest.
// Genereer met: pnpm setup-host (vanuit repo-root).
const keyPath = resolve(process.cwd(), ".keys", "manifest-key.txt");
const manifestKey = existsSync(keyPath) ? readFileSync(keyPath, "utf8").trim() : undefined;

/**
 * Twee builds uit één codebase.
 *
 * WAAROM: het manifest vroeg `debugger`, `cookies`, `nativeMessaging` en `<all_urls>`
 * tegelijk. Die combinatie is qua rechten niet te onderscheiden van een wachtwoorddief:
 * netwerkverkeer onderscheppen en vervalsen (Fetch.fulfillRequest), cookies lezen en
 * schrijven, op elke site, met een lokaal programma erachter dat de beoordelaar niet kan
 * inzien. De Web Store eist bovendien expliciet de smalste set rechten die volstaat.
 *
 * DE VONDST DIE DIT MOGELIJK MAAKT: klikken, typen, lezen, wachten, navigeren en
 * downloaden lopen allemaal via het content-script, niet via de debugger. Nagekeken in
 * lib/executor.ts. De debugger dient alleen netwerk-inspectie en request-onderschepping,
 * en dat zijn ontwikkelaarsfuncties. De boekhouder die facturen uit portalen haalt raakt
 * ze nooit aan. De winkelversie verliest dus geen enkele functie die de klant koopt.
 *
 *   pnpm build              volledige versie, voor eigen distributie en ontwikkeling
 *   YAD_WINKEL=1 pnpm build winkelversie, zonder debugger en zonder cookies
 *
 * De code detecteert dit tijdens het draaien (heeftCdp, heeftCookiePermissie) en geeft
 * een leesbare uitleg in plaats van een crash. Bewust runtime-detectie en geen build-vlag:
 * zo kan er geen versie ontstaan die denkt rechten te hebben die het manifest niet vraagt.
 */
const winkel = process.env["YAD_WINKEL"] === "1";

const basisRechten = [
  "nativeMessaging", // praten met het lokale Brein
  "sidePanel", // het bedieningspaneel
  "storage", // instellingen en opgeslagen taken, lokaal
  "tabs", // weten welk tabblad bediend wordt
  "scripting", // het content-script in de pagina zetten
  "webNavigation", // weten wanneer een pagina klaar is met laden
  "downloads", // zien of een bestand binnenkwam, en waar het staat
];

export default defineConfig({
  // Aparte uitvoermap voor de winkelversie. Zonder dit overschrijft een winkelbuild de map
  // waar de ontwikkelversie uit Chrome geladen is, en draait de eigenaar ineens zonder
  // debugger en cookies zonder dat hij het doorheeft.
  ...(winkel ? { outDir: ".output-winkel" } : {}),
  manifest: {
    name: winkel ? "Yad, AI browser helper on your own computer" : "Yad (full version)",
    description:
      "Say what you need and Yad does it, on any site in your own browser. Your passwords stay with you, you pick the AI.",
    permissions: winkel ? basisRechten : [...basisRechten, "cookies", "debugger"],
    host_permissions: ["<all_urls>"],
    icons: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
    action: {
      default_icon: {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
      },
    },
    side_panel: { default_path: "sidepanel.html" },
    ...(manifestKey ? { key: manifestKey } : {}),
  },
});
