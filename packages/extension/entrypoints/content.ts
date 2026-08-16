import { buildSnapshot } from "../lib/perception";
import { executeAction } from "../lib/executor";
import type { Action } from "@yad/shared";

// `defineContentScript` wordt door WXT auto-geimporteerd.
export default defineContentScript({
  matches: ["<all_urls>"],
  // Ook ín iframes draaien. Zonder dit ziet YAD alleen het hoofdframe, en juist de
  // dingen die ertoe doen zitten vaak in een vreemd frame: betaalformulieren, ingesloten
  // logins, chatwidgets. Perception haalt same-origin frames al binnen via
  // contentDocument, maar cross-origin gooit dan een SecurityError en het frame blijft
  // onzichtbaar. Een eigen script ín dat frame heeft dat probleem niet.
  allFrames: true,
  runAt: "document_idle",
  main() {
    // Idempotent: bij inject-op-aanvraag kan dit script tweemaal laden.
    const w = window as Window & { __yadLoaded?: boolean };
    if (w.__yadLoaded) return;
    w.__yadLoaded = true;

    // Eén ref->element map per pagina, gedeeld tussen perceptie en uitvoerder.
    const refMap = new Map<string, Element>();

    chrome.runtime.onMessage.addListener(
      (msg: { type?: string; action?: Action }, _sender, sendResponse) => {
        if (msg?.type === "YAD_PING") {
          sendResponse({ ok: true });
          return true;
        }
        if (msg?.type === "YAD_GET_STORAGE") {
          const local: Record<string, string> = {};
          try {
            for (let i = 0; i < window.localStorage.length; i++) {
              const k = window.localStorage.key(i);
              if (k) {
                const v = window.localStorage.getItem(k);
                if (v !== null) local[k] = v;
              }
            }
          } catch {
            /* cross-origin frame of beveiligingsbeperking: leeg object teruggeven */
          }
          sendResponse({ local });
          return true;
        }
        if (msg?.type === "YAD_SNAPSHOT") {
          try {
            sendResponse(buildSnapshot(refMap));
          } catch (e) {
            sendResponse({
              url: location.href,
              title: document.title,
              nodes: [],
              textDigest: `FOUT bij waarnemen: ${(e as Error).message}`,
            });
          }
          return true;
        }
        if (msg?.type === "YAD_ACT" && msg.action) {
          executeAction(msg.action, refMap)
            .then(sendResponse)
            .catch((e: Error) => sendResponse({ ok: false, detail: e.message }));
          return true;
        }
        return undefined;
      },
    );
  },
});
