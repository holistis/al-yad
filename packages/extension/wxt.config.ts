import { defineConfig } from "wxt";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Vaste extensie-sleutel (publiek deel) zodat de extensie-ID vast staat en
// overeenkomt met allowed_origins in het geregistreerde host-manifest.
// Genereer met: pnpm setup-host (vanuit repo-root).
const keyPath = resolve(process.cwd(), ".keys", "manifest-key.txt");
const manifestKey = existsSync(keyPath) ? readFileSync(keyPath, "utf8").trim() : undefined;

export default defineConfig({
  manifest: {
    name: "Yad — de hand",
    description: "Yad companion-extensie (de Hand): verbindt met het lokale Brein.",
    // tabs + host_permissions zijn nodig om de actieve tab te bedienen.
    // LET OP: <all_urls> is breed; vóór een Web Store-inzending versmallen naar
    // activeTab/optionele host-permissions (zie bouwplan, Web Store-risico).
    // `downloads` is nodig omdat een agent zonder downloads de helft van het echte werk
    // niet kan doen: "haal het rapport op en mail het" is een standaardklus. Klikken op
    // een downloadlink lukte al, maar YAD wist daarna niet of er iets binnenkwam en al
    // helemaal niet waar het stond. Met deze permissie zien we naam, pad en grootte, en
    // kan de companion het bestand van schijf lezen met zijn bestaande /fs/read-file.
    permissions: ["nativeMessaging", "sidePanel", "storage", "tabs", "scripting", "webNavigation", "cookies", "debugger", "downloads"],
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
