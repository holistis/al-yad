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
    if (a.kind === "extract") return { ok: true, extracted: "3 vacatures: Tolk A, Docent B, Helpdesk C" };
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

  it("auto-modus: voert een schrijf-actie uit zónder bevestiging te vragen", async () => {
    const hand = new MockHand();
    const router = new MockRouter(['{"kind":"click","ref":"e1"}']); // e1 = "Opslaan" (muterend)
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sla op");
    expect(hand.confirmCalls).toBe(0); // geen bevestiging gevraagd
    expect(hand.acts).toEqual([{ kind: "click", ref: "e1" }]);
    expect(out.status).toBe("klaar");
  });

  it("auto-modus: blokkeert /checkout nog steeds hard (deny-lijst niet te omzeilen)", async () => {
    const hand = new MockHand();
    const router = new MockRouter([
      '{"kind":"navigate","url":"https://shop.nl/checkout"}',
      '{"kind":"finish","summary":"gestopt"}',
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("reken af");
    expect(hand.acts).toHaveLength(0); // ondanks auto: niets uitgevoerd
    expect(hand.updates.some((u) => u.status === "geweigerd")).toBe(true);
    expect(out.status).toBe("klaar");
  });

  it("zet geëxtraheerde informatie in het eind-antwoord (niet alleen 'klaar')", async () => {
    const hand = new MockHand();
    const router = new MockRouter([
      '{"kind":"extract","what":"vacatures","ref":"e2"}',
      '{"kind":"finish","summary":"Klaar"}',
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("zoek 3 vacatures");
    expect(out.status).toBe("klaar");
    expect(out.summary).toContain("Tolk A");
    expect(out.summary).toContain("Helpdesk C");
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

// ── Sessie-verloop detectie ───────────────────────────────────────────────────

const LOGIN_SNAP: Snapshot = {
  url: "https://shop.nl/login",
  title: "Inloggen",
  nodes: [],
  textDigest: "",
};

class DynamicMockHand implements HandBridge {
  acts: Action[] = [];
  updates: Array<{ status: RunStatus; message: string }> = [];
  confirmReturn = true;
  confirmCalls = 0;
  private snapCall = 0;

  constructor(private readonly snaps: Snapshot[]) {}

  async requestSnapshot(): Promise<Snapshot> {
    const s = this.snaps[this.snapCall] ?? this.snaps[this.snaps.length - 1] ?? SNAP;
    this.snapCall++;
    return s;
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

describe("AgentLoop — sessie-verloop detectie", () => {
  it("detecteert een login-omleiding na stap 1 en vraagt bevestiging", async () => {
    // Volgorde: initSnap (voor cache), stap-1 snap, stap-2 snap (login!), stap-3 snap (na confirm)
    const hand = new DynamicMockHand([SNAP, SNAP, LOGIN_SNAP, SNAP]);
    hand.confirmReturn = true;
    const router = new MockRouter([
      '{"kind":"navigate","url":"https://shop.nl/account"}', // stap 1
      '{"kind":"finish","summary":"hervat"}',                 // stap 3 (stap 2 → continue)
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("ga naar account");
    expect(hand.confirmCalls).toBe(1);
    expect(hand.updates.some((u) => u.message.includes("Sessie verlopen"))).toBe(true);
    expect(out.status).toBe("klaar");
  });

  it("stopt de run als de gebruiker login-bevestiging weigert", async () => {
    // initSnap, stap-1, stap-2 (login → weigeren → gestopt)
    const hand = new DynamicMockHand([SNAP, SNAP, LOGIN_SNAP]);
    hand.confirmReturn = false;
    const router = new MockRouter([
      '{"kind":"navigate","url":"https://shop.nl/account"}',
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("ga naar account");
    expect(hand.confirmCalls).toBe(1);
    expect(out.status).toBe("gestopt");
  });

  it("triggert login-detectie NIET op stap 1 (startpagina kan al een loginpagina zijn)", async () => {
    // initSnap = login, stap-1 = login → guard step > 1 beschermt
    const hand = new DynamicMockHand([LOGIN_SNAP, LOGIN_SNAP, SNAP]);
    const router = new MockRouter(['{"kind":"finish","summary":"klaar"}']);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("doe iets");
    expect(hand.confirmCalls).toBe(0);
    expect(out.status).toBe("klaar");
  });
});

// ── DONE-predicaat bewaker (Stap 4) ──────────────────────────────────────────

// Gesorteerde URL bevat '?sort=lohi' — url-contains geeft deterministisch mismatch/match
const UNSORTED_SNAP: Snapshot = {
  url: "https://shop.nl/producten",
  title: "Producten",
  nodes: [{ ref: "e1", role: "combobox", name: "Sortering", value: "az" }],
  textDigest: "Name (A to Z) Sauce Labs Backpack $29.99 Sauce Labs Bike Light",
};

const SORTED_SNAP: Snapshot = {
  url: "https://shop.nl/producten?sort=lohi",
  title: "Producten",
  nodes: [{ ref: "e1", role: "combobox", name: "Sortering", value: "lohi" }],
  textDigest: "Price (low to high) Sauce Labs Onesie $7.99 Sauce Labs Bike Light $9.99",
};

// Finish met url-contains DONE-predicaat: deterministisch mismatch als URL sort=lohi ontbreekt
const FINISH_WITH_DONE = JSON.stringify({
  steps: [{ kind: "finish", summary: "Producten gesorteerd op prijs (laag naar hoog)", done: [{ type: "url-contains", value: "sort=lohi" }] }],
  rationale: "doel bereikt",
});

describe("AgentLoop — DONE-predicaat bewaker", () => {
  it("weigert finish als DONE-predicaten niet matchen, accepteert als ze wel matchen", async () => {
    // Volgorde snapshots: initSnap, stap-1 (unsorted → finish GEWEIGERD), stap-2 (select), stap-3 (sorted → finish GEACCEPTEERD)
    const hand = new DynamicMockHand([UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP, SORTED_SNAP]);
    const router = new MockRouter([
      FINISH_WITH_DONE, // stap 1: finish geweigerd (pagina nog niet gesorteerd)
      '{"steps":[{"kind":"select","ref":"e1","value":"lohi"}],"rationale":"sortering toepassen"}', // stap 2
      FINISH_WITH_DONE, // stap 3: finish geaccepteerd (pagina nu gesorteerd)
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sorteer producten op prijs laag naar hoog");

    expect(out.status).toBe("klaar");
    expect(out.summary).toContain("gesorteerd op prijs");
    // Select-actie werd uitgevoerd (finish was geweigerd, model herplande)
    expect(hand.acts.some((a) => a.kind === "select" && (a as { value?: string }).value === "lohi")).toBe(true);
    // Hand zag de "Finish geweigerd" status
    expect(hand.updates.some((u) => u.message.includes("Finish geweigerd"))).toBe(true);
  });

  it("eindigt met fout na MAX_FINISH_REJECTIONS+1 mislukte finish-pogingen", async () => {
    // Alle snapshots unsorted: elke finish-poging wordt geweigerd
    const hand = new DynamicMockHand([
      UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP,
    ]);
    const router = new MockRouter([
      FINISH_WITH_DONE, // stap 1: geweigerd (finishRejections=1 ≤ 2 → continue)
      FINISH_WITH_DONE, // stap 2: geweigerd (finishRejections=2 ≤ 2 → continue)
      FINISH_WITH_DONE, // stap 3: geweigerd (finishRejections=3 > 2 → fout)
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sorteer producten op prijs laag naar hoog");

    expect(out.status).toBe("fout");
    expect(hand.updates.some((u) => u.message.includes("Finish") && u.message.includes("geweigerd"))).toBe(true);
  });

  it("accepteert finish zonder DONE-predicaten direct (backwards compat)", async () => {
    const hand = new DynamicMockHand([UNSORTED_SNAP, UNSORTED_SNAP]);
    const router = new MockRouter([
      '{"steps":[{"kind":"finish","summary":"klaar, geen predicaten"}],"rationale":"simpele taak"}',
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("doe iets");

    expect(out.status).toBe("klaar");
    expect(out.summary).toContain("geen predicaten");
    // Geen updates over "Finish geweigerd"
    expect(hand.updates.every((u) => !u.message.includes("Finish geweigerd"))).toBe(true);
  });
});
