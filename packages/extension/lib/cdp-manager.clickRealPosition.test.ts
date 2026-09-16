import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clickRealPositionInPage } from "./cdp-manager";

/**
 * clickRealPositionInPage() lost het patroon op dat 2026-09-16 meerdere keren vastliep
 * (Atlassian Marketplace, Telegram Web, een Freshworks MUI Select): custom dropdowns/
 * comboboxen die event.isTrusted checken, en dus een JS-niveau click() negeren, EN een
 * OS-niveau klik (user32.dll/PowerShell) die onbetrouwbaar bleek zodra DPI-schaling,
 * vensterfocus-timing of scroll-positie niet exact klopten. Deze tests dekken de
 * aanroeplogica (welke CDP-commando's in welke volgorde, en hoe fouten van de pagina-kant
 * worden doorgegeven) — de JS-string die in de pagina draait (rectExpr) kan hier niet
 * tegen een echte DOM getest worden, net als bij insertRealTextInPage hiernaast.
 */

function mockChromeDebugger(rectResult: { value?: { ok: boolean; detail?: string; x?: number; y?: number } } | undefined) {
  const sendCommand = vi.fn(async (_target: { tabId: number }, method: string, _params?: Record<string, unknown>) => {
    if (method === "Runtime.evaluate") {
      return { result: rectResult };
    }
    return {};
  });
  const attach = vi.fn(async () => {});
  const detach = vi.fn(async () => {});
  const onEventListeners: Array<(...args: unknown[]) => void> = [];
  const onDetachListeners: Array<(...args: unknown[]) => void> = [];
  (globalThis as { chrome?: unknown }).chrome = {
    debugger: {
      attach,
      detach,
      sendCommand,
      onEvent: { addListener: (fn: (...args: unknown[]) => void) => onEventListeners.push(fn) },
      onDetach: { addListener: (fn: (...args: unknown[]) => void) => onDetachListeners.push(fn) },
    },
  };
  return { sendCommand, attach, detach };
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe("clickRealPositionInPage — echte, vertrouwde klik via CDP Input-domein", () => {
  it("dispatcht mouseMoved + mousePressed + mouseReleased op de opgemeten coordinaten", async () => {
    const { sendCommand } = mockChromeDebugger({ value: { ok: true, x: 123, y: 45 } });

    const result = await clickRealPositionInPage(1, "#organization-size-793");

    expect(result.ok).toBe(true);
    const mouseCalls = sendCommand.mock.calls.filter((c) => c[1] === "Input.dispatchMouseEvent");
    expect(mouseCalls).toHaveLength(3);
    expect(mouseCalls[0][2]).toMatchObject({ type: "mouseMoved", x: 123, y: 45 });
    expect(mouseCalls[1][2]).toMatchObject({ type: "mousePressed", x: 123, y: 45, button: "left", clickCount: 1 });
    expect(mouseCalls[2][2]).toMatchObject({ type: "mouseReleased", x: 123, y: 45, button: "left", clickCount: 1 });
  });

  it("geeft de foutmelding van de pagina door als het element niet bestaat", async () => {
    mockChromeDebugger({ value: { ok: false, detail: "element niet gevonden: #ontbreekt" } });

    const result = await clickRealPositionInPage(1, "#ontbreekt");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("niet gevonden");
  });

  it("geeft de naam van het overlappende element door als iets anders boven het doelwit ligt", async () => {
    mockChromeDebugger({
      value: { ok: false, detail: "een ander element (DIV.onetrust-banner) ligt boven op het doelwit op dit punt, klik zou het verkeerde element raken" },
    });

    const result = await clickRealPositionInPage(1, "#organization-size-793");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("onetrust-banner");
  });

  it("faalt netjes zonder debugger-permissie (Chrome Web Store-versie)", async () => {
    delete (globalThis as { chrome?: unknown }).chrome;

    const result = await clickRealPositionInPage(1, "#iets");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("volledige");
  });
});
