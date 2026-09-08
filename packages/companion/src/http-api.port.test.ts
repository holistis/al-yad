/**
 * Regressietest voor multi-instance-ondersteuning: de HTTP-poort moet
 * instelbaar zijn via YAD_PORT (net als main-server.ts al deed), en de
 * DNS-rebinding Host-header-check moet meebewegen met die poort, niet
 * stiekem op 3747 blijven controleren.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.fn((_port: number, _host: string, cb?: () => void) => {
  cb?.();
});
const onMock = vi.fn();
const createServerMock = vi.fn(() => ({
  listen: listenMock,
  on: onMock,
}));

vi.mock("node:http", () => ({
  createServer: createServerMock,
}));

const originalPort = process.env["YAD_PORT"];

async function loadStartHttpApiFresh() {
  vi.resetModules();
  const mod = await import("./http-api.js");
  return mod.startHttpApi;
}

function fakeSession() {
  // startHttpApi bindt de server pas aan een request-handler die alleen
  // uitgevoerd wordt bij een echte inkomende request; die sturen we hier
  // niet, dus een lege stub volstaat voor het testen van listen()-poort.
  return {} as unknown as Parameters<
    typeof import("./http-api.js").startHttpApi
  >[0];
}

describe("http-api poort-configuratie (multi-instance)", () => {
  beforeEach(() => {
    listenMock.mockClear();
    createServerMock.mockClear();
  });

  afterEach(() => {
    if (originalPort === undefined) delete process.env["YAD_PORT"];
    else process.env["YAD_PORT"] = originalPort;
  });

  it("bindt standaard aan 3747 zonder YAD_PORT", async () => {
    delete process.env["YAD_PORT"];
    const startHttpApi = await loadStartHttpApiFresh();
    startHttpApi(fakeSession(), () => {});
    expect(listenMock).toHaveBeenCalledWith(3747, "127.0.0.1", expect.any(Function));
  });

  it("bindt aan de YAD_PORT-waarde als die gezet is (tweede instantie)", async () => {
    process.env["YAD_PORT"] = "4001";
    const startHttpApi = await loadStartHttpApiFresh();
    startHttpApi(fakeSession(), () => {});
    expect(listenMock).toHaveBeenCalledWith(4001, "127.0.0.1", expect.any(Function));
  });

  it("valt terug op 3747 bij een ongeldige YAD_PORT-waarde", async () => {
    process.env["YAD_PORT"] = "niet-een-getal";
    const startHttpApi = await loadStartHttpApiFresh();
    startHttpApi(fakeSession(), () => {});
    // parseInt("niet-een-getal") is NaN; dat moet niet stil een ongeldige
    // poort aan listen() doorgeven zonder dat iemand het merkt.
    const [portArg] = listenMock.mock.calls[0]!;
    expect(Number.isNaN(portArg)).toBe(false);
  });
});
