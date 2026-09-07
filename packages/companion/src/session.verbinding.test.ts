import { describe, it, expect, vi, afterEach } from "vitest";
import { BrainSession } from "./session.js";
import { LlmRouter } from "./engine/router.js";
import type { BrainMessage } from "@yad/shared";

/**
 * Dekt de vraag "is de hand er nog echt". Tot deze suite bestond was `connected`
 * write-once: op true gezet bij de eerste HELLO (session.ts) en nergens ooit terug
 * op false. Ruim dertig endpoints in http-api.ts hangen aan isConnected() met een
 * 503-poort, dus die poorten stonden permanent open zodra de extensie ooit had
 * gegroet, ook als hij allang weg was.
 *
 * Live op 2026-09-07: /status gaf {"ok":true,"connected":true} terwijl /navigate
 * direct daarna ok:false teruggaf en de aansturing feitelijk niet werkte. Daardoor
 * was de storing niet te diagnosticeren.
 */

function maakSessie(): BrainSession {
  const verstuurd: BrainMessage[] = [];
  const router = new LlmRouter([], () => {});
  return new BrainSession(
    (m) => { verstuurd.push(m); },
    router,
    { version: "test", platform: "test" } as never,
    () => {},
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("BrainSession — verbonden betekent recent iets gehoord", () => {
  it("is niet verbonden voordat de hand ooit iets stuurde", () => {
    const s = maakSessie();
    expect(s.isConnected()).toBe(false);
  });

  it("is verbonden direct na HELLO", () => {
    const s = maakSessie();
    s.handle({ v: 1, type: "HELLO", id: "1", payload: {} });
    expect(s.isConnected()).toBe(true);
  });

  it("is NIET meer verbonden als de hand langer dan de stiltegrens zwijgt", () => {
    vi.useFakeTimers();
    const s = maakSessie();
    s.handle({ v: 1, type: "HELLO", id: "1", payload: {} });
    expect(s.isConnected()).toBe(true);

    // De extensie pingt elke 20s. Twee gemiste hartslagen plus marge betekent weg.
    vi.advanceTimersByTime(46_000);

    expect(s.isConnected()).toBe(false);
  });

  it("blijft verbonden zolang de hartslag doorkomt", () => {
    vi.useFakeTimers();
    const s = maakSessie();
    s.handle({ v: 1, type: "HELLO", id: "1", payload: {} });

    // Drie hartslagen van 20s: samen ruim over de grens van 45s, maar elke PING
    // verzet het venster, dus de sessie hoort verbonden te blijven.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(20_000);
      s.handle({ v: 1, type: "PING", id: `p${i}`, payload: {} });
    }

    expect(s.isConnected()).toBe(true);
  });

  it("meldt de stilte in milliseconden, zodat een storing meetbaar is", () => {
    vi.useFakeTimers();
    const s = maakSessie();
    expect(s.stilteMs()).toBe(-1); // nog nooit iets gehoord

    s.handle({ v: 1, type: "HELLO", id: "1", payload: {} });
    vi.advanceTimersByTime(5_000);

    expect(s.stilteMs()).toBe(5_000);
  });
});
