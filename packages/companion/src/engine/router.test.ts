import { describe, it, expect } from "vitest";
import { LlmRouter } from "./router.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { LlmError } from "./errors.js";
import type { ChatRequest, ChatResponse, LlmProvider } from "./types.js";

const REQ: ChatRequest = { messages: [{ role: "user", content: "hi" }] };
const noSleep = async (): Promise<void> => {};

class MockProvider implements LlmProvider {
  readonly model = "mock";
  calls = 0;
  constructor(
    readonly name: string,
    readonly tier: number,
    private readonly impl: (n: number) => Promise<ChatResponse>,
  ) {}
  chat(): Promise<ChatResponse> {
    this.calls += 1;
    return this.impl(this.calls);
  }
}

function ok(name: string): MockProvider {
  return new MockProvider(name, 0, async () =>
    ({ content: "ok", model: "mock", provider: name }) as ChatResponse,
  );
}

describe("LlmRouter", () => {
  it("gebruikt de eerste provider die slaagt", async () => {
    const a = ok("a");
    const b = ok("b");
    const router = new LlmRouter([a, b], { sleep: noSleep });
    const res = await router.chat(REQ);
    expect(res.provider).toBe("a");
    expect(res.attempts).toEqual(["a"]);
    expect(b.calls).toBe(0);
  });

  it("schakelt door naar de volgende provider bij een niet-retryable fout", async () => {
    const bad = new MockProvider("bad", 0, async () => {
      throw new LlmError("kapot", { retryable: false });
    });
    const good = ok("good");
    const router = new LlmRouter([bad, good], { sleep: noSleep });
    const res = await router.chat(REQ);
    expect(res.provider).toBe("good");
    expect(res.attempts).toEqual(["bad", "good"]);
    expect(bad.calls).toBe(1); // niet-retryable -> geen herhaling
  });

  it("retryt een retryable fout (429) en schakelt daarna door", async () => {
    const flapper = new MockProvider("flap", 0, async () => {
      throw new LlmError("429", { status: 429, retryable: true });
    });
    const good = ok("good");
    const router = new LlmRouter([flapper, good], { sleep: noSleep, retriesPerProvider: 2 });
    const res = await router.chat(REQ);
    expect(res.provider).toBe("good");
    expect(flapper.calls).toBe(3); // 1 + 2 retries
  });

  it("slaat een open circuit over", async () => {
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 60_000, now: () => 0 });
    breaker.recordFailure("dood"); // opent direct
    const dood = ok("dood");
    const levend = ok("levend");
    const router = new LlmRouter([dood, levend], { breaker, sleep: noSleep });
    const res = await router.chat(REQ);
    expect(res.provider).toBe("levend");
    expect(dood.calls).toBe(0); // overgeslagen
  });

  it("probeert op tier-volgorde, Ollama (tier 2) als laatste", async () => {
    const order: string[] = [];
    const mk = (name: string, tier: number): MockProvider =>
      new MockProvider(name, tier, async () => {
        order.push(name);
        throw new LlmError("nee", { retryable: false });
      });
    const ollama = mk("ollama", 2);
    const cloud = mk("cloud", 0);
    const router = new LlmRouter([ollama, cloud], { sleep: noSleep });
    await router.chat(REQ).catch(() => {});
    expect(order).toEqual(["cloud", "ollama"]); // tier 0 voor tier 2
  });

  it("gooit een duidelijke fout als alles faalt", async () => {
    const a = new MockProvider("a", 0, async () => {
      throw new LlmError("a-fout", { retryable: false });
    });
    const router = new LlmRouter([a], { sleep: noSleep });
    await expect(router.chat(REQ)).rejects.toThrow(/Alle providers faalden/);
  });

  it("health() rapporteert per provider", async () => {
    const router = new LlmRouter([ok("a"), ok("b")], { sleep: noSleep });
    const h = router.health();
    expect(h.map((x) => x.name).sort()).toEqual(["a", "b"]);
    expect(h.every((x) => x.open === false)).toBe(true);
  });
});
