import { describe, it, expect } from "vitest";
import type { ChatRequest } from "../engine/types.js";
import { callJudge, parseJudgeRaw } from "./judge.js";

class MockRouter {
  constructor(private readonly response: string) {}
  async chat(_req: ChatRequest): Promise<{ content: string; provider: string }> {
    return { content: this.response, provider: "mock" };
  }
}

const INPUT = { expected: "modal closes", url: "https://x.nl", hadEffect: true };

describe("parseJudgeRaw", () => {
  it("parses clean match JSON", () => {
    const r = parseJudgeRaw('{"verdict":"match","evidence":"form closed as expected"}');
    expect(r.verdict).toBe("match");
    expect(r.evidence).toBe("form closed as expected");
  });

  it("parses mismatch", () => {
    const r = parseJudgeRaw('{"verdict":"mismatch","evidence":"no confirmation shown"}');
    expect(r.verdict).toBe("mismatch");
  });

  it("parses unknown", () => {
    const r = parseJudgeRaw('{"verdict":"unknown","evidence":"no text extracted"}');
    expect(r.verdict).toBe("unknown");
  });

  it("handles markdown fences", () => {
    const r = parseJudgeRaw("```json\n{\"verdict\":\"match\",\"evidence\":\"ok\"}\n```");
    expect(r.verdict).toBe("match");
  });

  it("falls back to unknown on missing verdict", () => {
    const r = parseJudgeRaw('{"verdict":"yes","evidence":"something"}');
    expect(r.verdict).toBe("unknown");
  });

  it("falls back to unknown on invalid JSON", () => {
    const r = parseJudgeRaw("not json at all");
    expect(r.verdict).toBe("unknown");
    expect(r.evidence).toBeTruthy();
  });

  it("returns empty evidence string when field absent", () => {
    const r = parseJudgeRaw('{"verdict":"match"}');
    expect(r.verdict).toBe("match");
    expect(r.evidence).toBe("");
  });
});

describe("callJudge", () => {
  it("returns parsed verdict from router", async () => {
    const router = new MockRouter('{"verdict":"match","evidence":"success banner visible"}');
    const r = await callJudge(router, INPUT);
    expect(r.verdict).toBe("match");
    expect(r.evidence).toBe("success banner visible");
  });

  it("passes expected/extracted/url to router", async () => {
    let captured: ChatRequest | null = null;
    const router = {
      async chat(req: ChatRequest) {
        captured = req;
        return { content: '{"verdict":"unknown","evidence":""}', provider: "mock" };
      },
    };
    await callJudge(router, { expected: "form closes", url: "https://y.nl", extracted: "ok", hadEffect: true });
    const body = JSON.parse((captured!.messages[1]!.content as string));
    expect(body.expected).toBe("form closes");
    expect(body.extracted).toBe("ok");
    expect(body.url).toBe("https://y.nl");
    expect(body.had_effect).toBe(true);
  });

  it("returns unknown when router throws", async () => {
    const router = { chat: async () => { throw new Error("network"); } };
    const r = await callJudge(router, INPUT);
    expect(r.verdict).toBe("unknown");
    expect(r.evidence).toContain("mislukt");
  });
});
