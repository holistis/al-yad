import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { status, navigate, capture, runGoal, lastResult, CompanionError } from "./companion-client.js";

describe("companion-client", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetchOnce(body: unknown, init: { status?: number } = {}): ReturnType<typeof vi.fn> {
    const fn = vi.fn().mockResolvedValue({
      status: init.status ?? 200,
      text: async () => JSON.stringify(body),
    });
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  it("status() doet een GET naar /status zonder body", async () => {
    const fn = mockFetchOnce({ ok: true, connected: true, version: "0.1.0" });
    const result = await status();
    expect(fn).toHaveBeenCalledWith("http://127.0.0.1:3747/status", expect.objectContaining({ method: "GET" }));
    expect(result).toEqual({ ok: true, connected: true, version: "0.1.0" });
  });

  it("navigate() stuurt de url mee als JSON-body via POST", async () => {
    const fn = mockFetchOnce({ ok: true });
    await navigate("https://example.com");
    const [, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ url: "https://example.com" });
  });

  it("capture() is een kale POST zonder body-inhoud", async () => {
    const fn = mockFetchOnce({ ok: true, path: "C:\\x.json" });
    await capture();
    const [, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
  });

  it("runGoal() zet sync:true en autonomy:auto standaard", async () => {
    const fn = mockFetchOnce({ ok: true, status: "klaar" });
    await runGoal("doe iets");
    const [, init] = fn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ goal: "doe iets", sync: true, autonomy: "auto" });
  });

  it("runGoal() geeft optionele url/maxSteps door", async () => {
    const fn = mockFetchOnce({ ok: true, status: "klaar" });
    await runGoal("doe iets", { url: "https://x.com", maxSteps: 5 });
    const [, init] = fn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ url: "https://x.com", maxSteps: 5 });
  });

  it("lastResult() doet een GET naar /result", async () => {
    const fn = mockFetchOnce({ ok: true, status: "klaar" });
    await lastResult();
    expect(fn).toHaveBeenCalledWith("http://127.0.0.1:3747/result", expect.objectContaining({ method: "GET" }));
  });

  it("gooit een duidelijke CompanionError als de companion onbereikbaar is", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    await expect(status()).rejects.toBeInstanceOf(CompanionError);
    await expect(status()).rejects.toThrow(/Yad companion/);
  });

  it("gooit een duidelijke CompanionError bij een niet-JSON antwoord", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 500,
      text: async () => "<html>oeps</html>",
    }) as unknown as typeof fetch;
    await expect(status()).rejects.toBeInstanceOf(CompanionError);
  });
});
