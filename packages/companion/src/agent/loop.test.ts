import { describe, it, expect } from "vitest";
import { AgentLoop, type ChatLike, type HandBridge } from "./loop.js";
import type { Action, ActResult, RunStatus, Snapshot } from "@yad/shared";
import type { ChatRequest } from "../engine/types.js";

const SNAP: Snapshot = {
  url: "https://shop.nl/",
  title: "Shop",
  nodes: [
    { ref: "e1", role: "button", name: "Opslaan" },
    { ref: "e2", role: "link", name: "Producten" },
  ],
  textDigest: "",
};

class MockRouter implements ChatLike {
  private i = 0;
  constructor(private readonly queue: string[]) {}
  async chat(_req: ChatRequest): Promise<{ content: string; provider: string }> {
    const c = this.queue[this.i] ?? '{"kind":"finish","summary":"klaar"}';
    this.i++;
    return { content: c, provider: "mock" };
  }
}

class MockHand implements HandBridge {
  acts: Action[] = [];
  updates: Array<{ status: RunStatus; message: string }> = [];
  confirmReturn = true;
  confirmCalls = 0;
  constructor(private readonly snap: Snapshot = SNAP) {}
  async requestSnapshot(): Promise<Snapshot> {
    return this.snap;
  }
  async act(a: Action): Promise<ActResult> {
    this.acts.push(a);
    return { ok: true };
  }
  async requestConfirm(): Promise<boolean> {
    this.confirmCalls++;
    return this.confirmReturn;
  }
  update(u: { status: RunStatus; message: string }): void {
    this.updates.push({ status: u.status, message: u.message });
  }
}

const noSleep = async (): Promise<void> => {};

describe("AgentLoop", () => {
  it("voert een veilige navigatie uit en stopt bij finish", async () => {
    const hand = new MockHand();
    const router = new MockRouter([
      '{"kind":"navigate","url":"https://shop.nl/producten"}',
      '{"kind":"finish","summary":"gevonden"}',
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("zoek producten");
    expect(out.status).toBe("klaar");
    expect(out.summary).toBe("gevonden");
    expect(hand.acts).toHaveLength(1);
    expect(hand.acts[0]).toEqual({ kind: "navigate", url: "https://shop.nl/producten" });
  });

  it("weigert een actie naar /checkout en voert hem niet uit", async () => {
    const hand = new MockHand();
    const router = new MockRouter([
      '{"kind":"navigate","url":"https://shop.nl/checkout"}',
      '{"kind":"finish","summary":"gestopt"}',
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("reken af");
    expect(hand.acts).toHaveLength(0);
    expect(hand.updates.some((u) => u.status === "geweigerd")).toBe(true);
    expect(out.status).toBe("klaar");
  });

  it("vraagt bevestiging bij een schrijf-actie en stopt als de gebruiker weigert", async () => {
    const hand = new MockHand();
    hand.confirmReturn = false;
    const router = new MockRouter(['{"kind":"click","ref":"e1"}']); // e1 = "Opslaan"
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("sla op");
    expect(hand.confirmCalls).toBe(1);
    expect(hand.acts).toHaveLength(0);
    expect(out.status).toBe("gestopt");
  });

  it("voert de schrijf-actie uit als de gebruiker bevestigt", async () => {
    const hand = new MockHand();
    hand.confirmReturn = true;
    const router = new MockRouter(['{"kind":"click","ref":"e1"}']);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("sla op");
    expect(hand.confirmCalls).toBe(1);
    expect(hand.acts).toEqual([{ kind: "click", ref: "e1" }]);
    expect(out.status).toBe("klaar"); // queue leeg -> default finish
  });

  it("stopt met fout na drie onleesbare modelantwoorden", async () => {
    const hand = new MockHand();
    const router = new MockRouter(["geen json", "ook niet", "nog steeds niet"]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("doe iets");
    expect(out.status).toBe("fout");
    expect(hand.acts).toHaveLength(0);
  });
});
