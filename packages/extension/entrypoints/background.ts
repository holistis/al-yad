import { startNativePort, setYadTabId } from "../lib/native-port";
// defineBackground is auto-imported by WXT

export default defineBackground(() => {
  // Klik op het YAD-icoon → onthoud deze tab als de YAD-tab (stickyTabId).
  // openPanelOnActionClick: true → Chrome opent het panel zelf bij klik, altijd.
  if (chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  }

  // Onthoud welke tab de gebruiker heeft aangeklikt — zodat YAD altijd op die tab werkt.
  chrome.action.onClicked.addListener((tab) => {
    if (typeof tab.id === "number") {
      setYadTabId(tab.id);
    }
  });

  // Verbind met het Brein. De open native-poort houdt de service worker alive.
  startNativePort();
});
