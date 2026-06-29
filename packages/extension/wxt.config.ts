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
    permissions: ["nativeMessaging", "sidePanel", "storage", "tabs"],
    host_permissions: ["<all_urls>"],
    action: {},
    side_panel: { default_path: "sidepanel.html" },
    ...(manifestKey ? { key: manifestKey } : {}),
  },
});
