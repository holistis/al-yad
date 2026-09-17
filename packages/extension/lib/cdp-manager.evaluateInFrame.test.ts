import { describe, it, expect, afterEach, vi } from "vitest";
import { evaluateInFrame } from "./cdp-manager";

/**
 * evaluateInFrame() lost op wat 2026-09-17 een blinde vlek bleek: Forge/Connect-apps
 * (Atlassian Marketplace) draaien vrijwel altijd in een cross-origin iframe, waarvan
 * de inhoud met gewone Runtime.evaluate op het hoofdframe onzichtbaar blijft (browser-
 * eigen same-origin-policy, geen YAD-beperking). Page.createIsolatedWorld geeft een
 * JS-context BINNEN het doelframe, ook cross-origin, zolang het frame in hetzelfde
 * renderer-proces zit. Voor een frame in een EIGEN proces (site-isolation, ontdekt bij
 * een live-test tegen een echte Forge-app) valt de functie terug op Target.setAutoAttach
 * + flat-mode sessionId-routing — een directe chrome.debugger.attach({targetId}) op
 * zo'n sub-target bleek bij diezelfde live-test "Not allowed" te geven.
 */

type Listener = (source: { tabId?: number }, method: string, params?: unknown) => void;

function mockChromeDebugger(opts: {
  frameTree: unknown;
  attachedToTargetEvent?: { sessionId: string; targetInfo: { url: string; type: string } };
  evaluateResult?: { result?: { value?: unknown; type?: string }; exceptionDetails?: { text?: string } };
}) {
  const listeners: Listener[] = [];
  const sendCommand = vi.fn(async (_target: unknown, method: string, _params?: Record<string, unknown>) => {
    if (method === "Page.getFrameTree") return { frameTree: opts.frameTree };
    if (method === "Page.createIsolatedWorld") return { executionContextId: 42 };
    if (method === "Target.setAutoAttach") {
      if (opts.attachedToTargetEvent) {
        // Chrome vuurt attachedToTarget synchroon/vrijwel-synchroon na setAutoAttach
        // voor al bestaande matchende kind-targets — simuleer dat hier ook zo.
        queueMicrotask(() => listeners.forEach((l) => l({ tabId: 1 }, "Target.attachedToTarget", opts.attachedToTargetEvent)));
      }
      return {};
    }
    if (method === "Runtime.evaluate") return opts.evaluateResult ?? { result: { value: "ok", type: "string" } };
    return {};
  });
  (globalThis as { chrome?: unknown }).chrome = {
    debugger: {
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
      sendCommand,
      onEvent: {
        addListener: (fn: Listener) => listeners.push(fn),
        removeListener: (fn: Listener) => {
          const i = listeners.indexOf(fn);
          if (i !== -1) listeners.splice(i, 1);
        },
      },
      onDetach: { addListener: () => {} },
    },
  };
  return { sendCommand };
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe("evaluateInFrame — JS uitvoeren binnen een specifiek (cross-origin) iframe", () => {
  it("vindt het juiste frame op een deel van de URL en evalueert daarbinnen (same-process)", async () => {
    const frameTree = {
      frame: { id: "top", url: "https://bugbounty-test.atlassian.net/browse/DEMO-1" },
      childFrames: [
        { frame: { id: "child1", url: "https://a1096093.cdn.optimizely.com/x.html" } },
        { frame: { id: "child2", url: "https://cdn.prod.atlassian-dev.net/forge-app/abc123" } },
      ],
    };
    const { sendCommand } = mockChromeDebugger({
      frameTree,
      evaluateResult: { result: { value: "Sentiment Dashboard", type: "string" } },
    });

    const result = await evaluateInFrame(1, "atlassian-dev.net", "document.title");

    expect(result.error).toBeUndefined();
    expect(result.value).toContain("Sentiment Dashboard");
    const isolatedCall = sendCommand.mock.calls.find((c) => c[1] === "Page.createIsolatedWorld");
    expect(isolatedCall?.[2]).toMatchObject({ frameId: "child2" });
  });

  it("valt terug op Target.setAutoAttach + flat-mode sessionId als het frame een EIGEN proces heeft (site-isolation)", async () => {
    const frameTree = { frame: { id: "top", url: "https://bugbounty-test.atlassian.net/browse/DEMO-1" } };
    const { sendCommand } = mockChromeDebugger({
      frameTree,
      attachedToTargetEvent: {
        sessionId: "sess-1",
        targetInfo: { url: "https://cdn.prod.atlassian-dev.net/forge-app/abc123", type: "iframe" },
      },
      evaluateResult: { result: { value: "Sentiment Dashboard", type: "string" } },
    });

    const result = await evaluateInFrame(1, "atlassian-dev.net", "document.title");

    expect(result.error).toBeUndefined();
    expect(result.value).toContain("Sentiment Dashboard");
    const evalCall = sendCommand.mock.calls.find((c) => c[1] === "Runtime.evaluate");
    expect(evalCall?.[0]).toEqual({ tabId: 1, sessionId: "sess-1" });
  });

  it("geeft een duidelijke fout als er ook via auto-attach geen match komt (met timeout)", async () => {
    const frameTree = {
      frame: { id: "top", url: "https://example.com" },
      childFrames: [{ frame: { id: "child1", url: "https://ergens-anders.com/x" } }],
    };
    mockChromeDebugger({ frameTree });

    const result = await evaluateInFrame(1, "niet-bestaand-domein.com", "1");

    expect(result.error).toContain("geen frame gevonden");
    expect(result.error).toContain("ergens-anders.com");
  }, 7_000);

  it("faalt netjes zonder debugger-permissie (Chrome Web Store-versie)", async () => {
    delete (globalThis as { chrome?: unknown }).chrome;

    const result = await evaluateInFrame(1, "iets", "1");

    expect(result.error).toContain("volledige");
  });
});
