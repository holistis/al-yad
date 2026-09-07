import { describe, it, expect } from "vitest";
import { AgentLoop, type ChatLike, type HandBridge } from "./loop.js";
import type { Action, ActResult, RunStatus, Snapshot } from "@yad/shared";
import type { ChatRequest } from "../engine/types.js";

/**
 * Dekt de vraag "mag deze run het geheugen voeden".
 *
 * session.ts schreef herstel-hints als BEWEZEN weg zodra een run status "klaar" had,
 * en postte ze bovendien naar het gedeelde brein op een server. De DONE-poort laat
 * een "indeterminate" verdict bewust door (een run mag niet vastlopen op een
 * predicaat dat niets kon vaststellen), en zo'n run telde dus als bewijs.
 *
 * Live gevolg op 2026-09-07: data/recovery-store.jsonl bevat zeven hints voor
 * youtube.com die als bewezen zijn weggeschreven, waaronder "zoek de sectie met
 * contractbestanden" op een videopagina. Die hints kunnen daarna de bredere hint
 * overschrijven die bij elke volgende gebruiker als eerste wordt geprobeerd.
 */

const SNAP: Snapshot = {
  url: "https://www.youtube.com/watch?v=test",
  title: "Video",
  nodes: [{ ref: "e1", role: "button", name: "Reageren" }],
  textDigest: "",
};

class ScriptRouter implements ChatLike {
  private i = 0;
  constructor(private readonly queue: string[]) {}
  async chat(_req: ChatRequest): Promise<{ content: string; provider: string; model: string }> {
    const c = this.queue[this.i] ?? this.queue[this.queue.length - 1] ?? "{}";
    this.i++;
    return { content: c, provider: "mock", model: "mock" };
  }
}

class StilleHand implements HandBridge {
  acts: Action[] = [];
  constructor(private readonly snap: Snapshot = SNAP) {}
  async requestSnapshot(): Promise<Snapshot> { return this.snap; }
  async requestScreenshot(): Promise<string | null> { return null; }
  async act(a: Action): Promise<ActResult> {
    this.acts.push(a);
    if (a.kind === "extract") return { ok: true, extracted: "iets gelezen" };
    return { ok: true };
  }
  async requestConfirm(): Promise<boolean> { return true; }
  update(_u: { status: RunStatus; message: string }): void {}
}

describe("AgentLoop — alleen een bevestigde finish mag het geheugen voeden", () => {
  it("markeert een finish die de poort niet kon bevestigen NIET als geverifieerd", async () => {
    // role-absent op een rol die nergens voorkomt geeft geen harde match op de pagina:
    // de poort laat de run door, maar heeft niets kunnen vaststellen.
    const router = new ScriptRouter([
      '{"kind":"finish","summary":"Gedaan","done":[{"type":"text-present","text":"deze tekst staat nergens op de pagina"}]}',
    ]);
    const hand = new StilleHand();
    const loop = new AgentLoop(router, hand);

    await loop.run("Plaats een reactie", 5);

    // De kern: deze run mag geen hints als bewezen wegschrijven en niets naar het
    // gedeelde brein sturen.
    expect(loop.verifiedFinish).toBe(false);
  });

  it("markeert een finish die de poort WEL bevestigde als geverifieerd", async () => {
    // role-present op een knop die echt in de snapshot staat: dit kan de poort
    // daadwerkelijk vaststellen.
    const router = new ScriptRouter([
      '{"kind":"finish","summary":"Gedaan","done":[{"type":"role-present","role":"button","name":"Reageren"}]}',
    ]);
    const hand = new StilleHand();
    const loop = new AgentLoop(router, hand);

    const result = await loop.run("Controleer of de reageerknop er is", 5);

    expect(result.status).toBe("klaar");
    expect(loop.verifiedFinish).toBe(true);
  });

  it("markeert een run die vastliep nooit als geverifieerd", async () => {
    const router = new ScriptRouter(['{"kind":"extract","what":"lezen"}', '{"kind":"extract","what":"nog eens lezen"}']);
    const hand = new StilleHand();
    const loop = new AgentLoop(router, hand);

    const result = await loop.run("Plaats een reactie", 6);

    expect(result.status).not.toBe("klaar");
    expect(loop.verifiedFinish).toBe(false);
  });
});
