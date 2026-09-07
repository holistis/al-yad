import { describe, it, expect } from "vitest";
import { AgentLoop, type ChatLike, type HandBridge } from "./loop.js";
import type { Action, ActResult, RunStatus, Snapshot } from "@yad/shared";
import type { ChatRequest } from "../engine/types.js";

/**
 * Deze suite dekt twee code-paden die "klaar" teruggeven zonder ooit langs de
 * DONE-poort te gaan. De poort zelf werkt (loop.ts:990-1060, run rqfpmbjp werd er
 * tweemaal door geweigerd), maar hij zit alleen op de voordeur.
 *
 * Live bewijs uit data/run-history.jsonl en C:\Code\yad-step-log.jsonl van
 * 2026-09-07: de runs 9guchw9l en 7vigymjv kregen de opdracht een YouTube-reactie
 * te plaatsen, voerden uitsluitend navigate/scroll/extract uit, en werden allebei
 * als status "klaar" geboekt. Er is nooit iets geplaatst. De YouTube API bevestigde
 * dat onafhankelijk.
 *
 * "gestopt" bestaat al als status en mapt in session.ts:58 naar outcome "stuck",
 * dus deze fix heeft geen nieuw type nodig: hij vervangt een onwaarheid door de
 * waarheid die er al was.
 */

const SNAP: Snapshot = {
  url: "https://www.youtube.com/watch?v=test",
  title: "Video",
  nodes: [
    { ref: "e1", role: "button", name: "Reageren" },
    { ref: "e2", role: "textbox", name: "Voeg een reactie toe" },
  ],
  textDigest: "",
};

class ScriptRouter implements ChatLike {
  private i = 0;
  constructor(private readonly queue: string[]) {}
  async chat(_req: ChatRequest): Promise<{ content: string; provider: string; model: string }> {
    // Blijft na het script hetzelfde antwoord herhalen: zo bootsen we een model na
    // dat in een lus blijft hangen in plaats van netjes finish aan te roepen.
    const c = this.queue[this.i] ?? this.queue[this.queue.length - 1] ?? "{}";
    this.i++;
    return { content: c, provider: "mock", model: "mock" };
  }
}

class TellendeHand implements HandBridge {
  acts: Action[] = [];
  updates: Array<{ status: RunStatus; message: string }> = [];
  constructor(private readonly snap: Snapshot = SNAP) {}
  async requestSnapshot(): Promise<Snapshot> {
    return this.snap;
  }
  async requestScreenshot(): Promise<string | null> { return null; }
  async act(a: Action): Promise<ActResult> {
    this.acts.push(a);
    if (a.kind === "extract") return { ok: true, extracted: "reactieveld en Reageren-knop gevonden" };
    return { ok: true };
  }
  async requestConfirm(): Promise<boolean> { return true; }
  update(u: { status: RunStatus; message: string }): void {
    this.updates.push({ status: u.status, message: u.message });
  }
}

describe("AgentLoop — een run die de gevraagde actie nooit deed mag geen 'klaar' melden", () => {
  it("extract-lus: twee opeenvolgende extracts op dezelfde URL eindigt NIET als klaar", async () => {
    // Precies het patroon van run 9guchw9l: het model blijft de pagina uitlezen
    // in plaats van de gevraagde reactie te typen en te plaatsen.
    const router = new ScriptRouter([
      '{"kind":"extract","what":"reactieveld zoeken"}',
      '{"kind":"extract","what":"reactieveld nogmaals zoeken"}',
    ]);
    const hand = new TellendeHand();
    const loop = new AgentLoop(router, hand);

    const result = await loop.run("Plaats deze reactie onder de comment van AdvantestInc", 10);

    // De kern: alleen lezen is niet klaar zijn. Een gebruiker die "klaar" leest,
    // gelooft dat zijn reactie geplaatst is.
    expect(result.status).not.toBe("klaar");
    expect(hand.acts.some((a) => a.kind === "type")).toBe(false);
  });

  it("stappenplafond: opraken van de stappen eindigt NIET als klaar", async () => {
    // Elke stap een ANDERE actie, zodat geen enkele herhaal- of lus-bewaker eerder
    // ingrijpt en de run het stappenplafond op loop.ts:1407-1409 daadwerkelijk raakt.
    // Daar staat vandaag: status "klaar" met de samenvatting "Gestopt na N stappen" —
    // de code weet dus zelf dat de run niet af is, en noemt hem toch klaar.
    const router = new ScriptRouter([
      '{"kind":"scroll","direction":"down","amount":2}',
      '{"kind":"scroll","direction":"up","amount":3}',
      '{"kind":"scroll","direction":"down","amount":7}',
      '{"kind":"scroll","direction":"up","amount":4}',
    ]);
    const hand = new TellendeHand();
    const loop = new AgentLoop(router, hand);

    const result = await loop.run("Plaats deze reactie onder de comment van AdvantestInc", 4);

    expect(result.status).not.toBe("klaar");
  });

  it("een echte finish met een kloppend DONE-predicaat blijft gewoon klaar (geen regressie)", async () => {
    // Tegenproef: de poort mag geslaagde runs niet gaan blokkeren.
    const router = new ScriptRouter([
      '{"kind":"finish","summary":"Reactie geplaatst","done":[{"type":"role-absent","role":"yad-test-nonexistent-role"}]}',
    ]);
    const hand = new TellendeHand();
    const loop = new AgentLoop(router, hand);

    const result = await loop.run("Lees de titel van deze pagina", 5);

    expect(result.status).toBe("klaar");
  });
});
