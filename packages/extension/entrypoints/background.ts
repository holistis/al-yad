import { startNativePort } from "../lib/native-port";
// defineBackground is auto-imported by WXT

// `defineBackground` wordt door WXT auto-geimporteerd (geen import-regel nodig).

export default defineBackground(() => {
  // Open de side panel als de gebruiker op het toolbar-icoon klikt.
  if (chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  }

  // Verbind met het Brein. De open native-poort houdt de service worker alive.
  startNativePort();
});
