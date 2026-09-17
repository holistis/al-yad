import { describe, it, expect, afterEach, vi } from "vitest";
import { evaluateInFrame } from "./cdp-manager";

/**
 * evaluateInFrame() lost op wat 2026-09-17 een blinde vlek bleek: Forge/Connect-apps
 * (Atlassian Marketplace) draaien vrijwel altijd in een cross-origin iframe, waarvan
 * de inhoud met gewone Runtime.evaluate op het hoofdframe onzichtbaar blijft (browser-
 * eigen same-origin-policy, geen YAD-beperking). Page.createIsolatedWorld geeft een
 * JS-context BINNEN het doelframe, ook cross-origin, omdat de debugger-sessie op
 * tab-niveau draait.
 */

function mockChromeDebugger(opts: {
  frameTree: unknown;
  isolatedWorld?: { executionContextId: number };
  evaluateResult?: { result?: { value?: unknown; type?: string }; exceptionDetails?: { text?: string } };
}) {
  const sendCommand = vi.fn(async (_target: { tabId: number }, method: string, _params?: Record<string, unknown>) => {
    if (method === "Page.getFrameTree") return { frameTree: opts.frameTree };
    if (method === "Page.createIsolatedWorld") return opts.isolatedWorld ?? { executionContextId: 42 };
    if (method === "Runtime.evaluate") return opts.evaluateResult ?? { result: { value: "ok", type: "string" } };
    return {};
  });
  (globalThis as { chrome?: unknown }).chrome = {
    debugger: {
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
      sendCommand,
      onEvent: { addListener: () => {} },
      onDetach: { addListener: () => {} },
    },
  };
  return { sendCommand };
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe("evaluateInFrame — JS uitvoeren binnen een specifiek (cross-origin) iframe", () => {
  it("vindt het juiste frame op een deel van de URL en evalueert daarbinnen", async () => {
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

  it("geeft een duidelijke fout met alle gevonden frames als er geen match is", async () => {
    const frameTree = {
      frame: { id: "top", url: "https://example.com" },
      childFrames: [{ frame: { id: "child1", url: "https://ergens-anders.com/x" } }],
    };
    mockChromeDebugger({ frameTree });

    const result = await evaluateInFrame(1, "niet-bestaand-domein.com", "1");

    expect(result.error).toContain("geen frame gevonden");
    expect(result.error).toContain("ergens-anders.com");
  });

  it("faalt netjes zonder debugger-permissie (Chrome Web Store-versie)", async () => {
    delete (globalThis as { chrome?: unknown }).chrome;

    const result = await evaluateInFrame(1, "iets", "1");

    expect(result.error).toContain("volledige");
  });
});
