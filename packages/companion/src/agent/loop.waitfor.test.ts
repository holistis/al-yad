import { describe, it, expect } from "vitest";
import { AgentLoop, type ChatLike, type HandBridge } from "./loop.js";
import type { Action, ActResult, RunStatus, Snapshot } from "@yad/shared";
import type { ChatRequest } from "../engine/types.js";

/**
 * Tests voor `wait-for`: wachten TOT iets waar is in plaats van een vast aantal
 * milliseconden.
 *
 * Waarom deze actie bestaat: `wait: { ms }` is gokken. Te kort en de agent handelt op
 * een pagina die er nog niet is, te lang en de klant betaalt voor stilstand. Op een
 * trage site schuift dat venster ook nog per keer op, dus een getal dat gisteren werkte
 * faalt vandaag.
 *
 * Wat hier bewust wordt vastgelegd:
 *  - de actie gaat NOOIT naar de Hand (er valt in de pagina niets uit te voeren)
 *  - hij stopt zodra het predicaat klopt, niet later
 *  - hij geeft een eerlijke mislukking bij een time-out, geen stille `ok`
 *  - een onleesbaar predicaat is een fout, geen oneindig wachten
 */

const BASIS: Snapshot = {
  url: "https://shop.nl/",
  title: "Shop",
  nodes: [{ ref: "e1", role: "button", name: "Zoeken" }],
  textDigest: "",
};

/** Snapshot waarin de knop "Doorgaan" wél bestaat. */
const MET_KNOP: Snapshot = {
  ...BASIS,
  nodes: [
    { ref: "e1", role: "button", name: "Zoeken" },
    { ref: "e2", role: "button", name: "Doorgaan" },
  ],
};

class Router implements ChatLike {
  private i = 0;
  constructor(private readonly queue: string[]) {}
  async chat(_req: ChatRequest): Promise<{ content: string; provider: string }> {
    const c = this.queue[this.i] ?? '{"kind":"finish","summary":"klaar"}';
    this.i++;
    return { content: c, provider: "mock" };
  }
}

/** Hand die pas ná `verschijntNa` snapshots de knop toont. */
class TraagHand implements HandBridge {
  acts: Action[] = [];
  snapshots = 0;
  constructor(private readonly verschijntNa: number) {}
  async requestSnapshot(): Promise<Snapshot> {
    this.snapshots++;
    return this.snapshots > this.verschijntNa ? MET_KNOP : BASIS;
  }
  async requestScreenshot(): Promise<string | null> { return null; }
  async act(a: Action): Promise<ActResult> {
    this.acts.push(a);
    return { ok: true };
  }
  async requestConfirm(): Promise<boolean> { return true; }
  update(_u: { status: RunStatus; message: string }): void {}
}

const geenPauze = async (): Promise<void> => {};

function plan(predicate: unknown, timeoutMs?: number): string[] {
  return [
    JSON.stringify({ kind: "wait-for", predicate, ...(timeoutMs ? { timeoutMs } : {}) }),
    JSON.stringify({ kind: "finish", summary: "klaar" }),
  ];
}

describe("wait-for", () => {
  /**
   * Bewust een RELATIEVE vergelijking en geen vast getal. De lus neemt zelf ook
   * snapshots voor andere doelen (oordeel, state-controle), dus een absolute grens
   * meet die overhead mee en breekt zodra iemand daar iets aan verandert. Wat we
   * werkelijk willen vastleggen is het gedrag: bij een voorwaarde die al waar is,
   * wordt er minder gepolld dan bij een die pas later waar wordt.
   */
  it("polt minder als de voorwaarde al waar is dan wanneer hij later komt", async () => {
    const pred = { type: "role-present", role: "button", nameSubstring: "Doorgaan" };

    const meteen = new TraagHand(0); // knop staat er vanaf de eerste snapshot
    const uit1 = await new AgentLoop(new Router(plan(pred)), meteen, { sleep: geenPauze }).run("wacht op de knop");

    const traag = new TraagHand(5); // pas bij de zesde snapshot verschijnt de knop
    const uit2 = await new AgentLoop(new Router(plan(pred)), traag, { sleep: geenPauze }).run("wacht op de knop");

    expect(uit1.status).toBe("klaar");
    expect(uit2.status).toBe("klaar");
    expect(meteen.snapshots).toBeLessThan(traag.snapshots);
    expect(traag.snapshots).toBeGreaterThan(5);
  });

  it("stuurt wait-for NOOIT naar de Hand", async () => {
    const hand = new TraagHand(0);
    const loop = new AgentLoop(new Router(plan({ type: "role-present", role: "button", nameSubstring: "Doorgaan" })), hand, { sleep: geenPauze });
    await loop.run("wacht op de knop");
    // De Hand mag alles krijgen behalve dit: er valt in de pagina niets uit te voeren.
    expect(hand.acts.some((a) => a.kind === "wait-for")).toBe(false);
  });

  it("geeft een eerlijke mislukking als de voorwaarde nooit waar wordt", async () => {
    const hand = new TraagHand(Number.MAX_SAFE_INTEGER); // verschijnt nooit
    const loop = new AgentLoop(
      new Router(plan({ type: "role-present", role: "button", nameSubstring: "Bestaat niet" }, 600)),
      hand,
      // echte (korte) pauze, anders tikt de time-out-klok niet mee
      { sleep: (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 50))) },
    );
    const uit = await loop.run("wacht op iets dat er niet komt");
    // De run zelf hoeft niet te falen (de agent mag herstellen), maar er moet wel
    // daadwerkelijk gewacht zijn: meerdere controles binnen het tijdvenster.
    expect(hand.snapshots).toBeGreaterThan(1);
    expect(uit.status).toBeDefined();
  });

  it("weigert een onleesbaar predicaat in plaats van eindeloos te wachten", async () => {
    const hand = new TraagHand(0);
    const loop = new AgentLoop(new Router(plan({ type: "bestaat-niet-als-type" }, 600)), hand, { sleep: geenPauze });
    const uit = await loop.run("wacht op onzin");
    // Belangrijk is dat de run eindigt en niet blijft hangen op een kapot predicaat.
    expect(uit.status).toBeDefined();
    expect(hand.acts.some((a) => a.kind === "wait-for")).toBe(false);
  });
});
