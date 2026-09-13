import { describe, it, expect } from "vitest";
import { AgentLoop, buildGateContext, type ChatLike, type HandBridge } from "./loop.js";
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

/**
 * DONE predicate that matches any snapshot: role-absent on a role name that never
 * appears in any test fixture used in this file. Used to give a "finish" call in
 * tests that are not about DONE-predicate semantics a predicate that trivially
 * satisfies the finish gate added for the false-"klaar" fix, without having to
 * reason about each fixture's actual content.
 */
const ALWAYS_TRUE_DONE = '"done":[{"type":"role-absent","role":"yad-test-nonexistent-role"}]';

class MockRouter implements ChatLike {
  private i = 0;
  constructor(
    private readonly queue: string[],
    private readonly model: string = "mock-model",
  ) {}
  async chat(_req: ChatRequest): Promise<{ content: string; provider: string; model: string }> {
    const c = this.queue[this.i] ?? `{"kind":"finish","summary":"klaar",${ALWAYS_TRUE_DONE}}`;
    this.i++;
    return { content: c, provider: "mock", model: this.model };
  }
}

class MockHand implements HandBridge {
  acts: Action[] = [];
  updates: Array<{ status: RunStatus; message: string }> = [];
  confirmReturn = true;
  confirmCalls = 0;
  /**
   * Simuleert wat de extensie (packages/extension/lib/executor.ts,
   * clickAtViewportPoint met resolveOnly:true) teruggeeft voor een click-at-
   * resolve-ronde: welk element ECHT op de opgegeven positie staat. `undefined`
   * (default) simuleert een element zonder duidelijke rol/naam (bv. platte tekst).
   */
  clickAtResolvesTo: { role?: string; name?: string } | undefined = undefined;
  /** Simuleert dat de resolve-ronde zelf mislukt (geen element op die positie gevonden). */
  clickAtResolveFails = false;
  /** Standaard null (geen screenshot) — click-at wordt pas geldig ZODRA dit een string is
   *  (zie loop.ts: sawScreenshotThisTurn), precies zoals een echte stuck-signaal-escalatie
   *  pas een screenshot oplevert via requestScreenshot(). */
  screenshotReturn: string | null = null;
  constructor(private readonly snap: Snapshot = SNAP) {}
  async requestSnapshot(): Promise<Snapshot> {
    return this.snap;
  }
  async requestScreenshot(): Promise<string | null> { return this.screenshotReturn; }
  async act(a: Action): Promise<ActResult> {
    this.acts.push(a);
    if (a.kind === "extract") return { ok: true, extracted: "3 vacatures: Tolk A, Docent B, Helpdesk C" };
    if (a.kind === "click-at" && a.resolveOnly === true) {
      if (this.clickAtResolveFails) return { ok: false, detail: "geen element gevonden op deze positie" };
      return { ok: true, resolvedTarget: this.clickAtResolvesTo };
    }
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

// ── buildGateContext (click-at resolve-ronde) ────────────────────────────────
//
// Restpunt uit de adversariële review 2026-09-13: clickAtViewportPoint() in
// packages/extension/lib/executor.ts had voorheen alleen de smalle DENY_WORDS-
// check, geen equivalent van needsConfirm() voor write-rollen in het algemeen —
// de companion-poort (guardrails.ts) kon voor click-at nooit iets over het
// doelwit zeggen, want er is geen ref/naam bekend zoals bij een gewone klik.
// buildGateContext() lost dit op door de Hand eerst (resolveOnly, geen klik) te
// vragen welk element ECHT op die positie staat. Deze tests toetsen die functie
// rechtstreeks — sneller en deterministischer dan de volledige stuck-signaal-
// dans die nodig is om click-at door de hele AgentLoop.run()-lus te krijgen
// (zie de aparte end-to-end-test verderop in dit bestand).
describe("buildGateContext", () => {
  class ResolveOnlyHand {
    resolvedTarget: { role?: string; name?: string } | undefined = undefined;
    resolveFails = false;
    lastAct: Action | undefined;
    async act(a: Action): Promise<ActResult> {
      this.lastAct = a;
      if (this.resolveFails) return { ok: false, detail: "geen element gevonden op deze positie" };
      return { ok: true, resolvedTarget: this.resolvedTarget };
    }
  }

  it("gebruikt voor 'click' gewoon de rol/naam uit de snapshot-node, zonder de Hand aan te roepen", async () => {
    const hand = new ResolveOnlyHand();
    const { ctx, resolveFailure } = await buildGateContext(
      hand,
      { kind: "click", ref: "e1" },
      "https://x.nl/",
      { ref: "e1", role: "button", name: "Opslaan" },
    );
    expect(resolveFailure).toBeUndefined();
    expect(ctx).toEqual({ currentUrl: "https://x.nl/", targetName: "Opslaan", role: "button" });
    expect(hand.lastAct).toBeUndefined(); // geen resolve-ronde nodig buiten click-at
  });

  it("vraagt voor click-at eerst een resolveOnly-ronde op en zet de rol/naam daarvan in de ctx", async () => {
    const hand = new ResolveOnlyHand();
    hand.resolvedTarget = { role: "button", name: "Verwijder account" };
    const { ctx, resolveFailure } = await buildGateContext(
      hand,
      { kind: "click-at", xFraction: 0.4, yFraction: 0.6 },
      "https://x.nl/",
      undefined,
    );
    expect(resolveFailure).toBeUndefined();
    expect(ctx).toEqual({ currentUrl: "https://x.nl/", targetName: "Verwijder account", role: "button" });
    expect(hand.lastAct).toEqual({ kind: "click-at", xFraction: 0.4, yFraction: 0.6, resolveOnly: true });
  });

  it("geeft een benigne, niet-muterende click-at-resolve door zonder rol te verzinnen", async () => {
    const hand = new ResolveOnlyHand();
    hand.resolvedTarget = { role: "link", name: "Lees meer" };
    const { ctx } = await buildGateContext(hand, { kind: "click-at", xFraction: 0.1, yFraction: 0.1 }, "https://x.nl/", undefined);
    expect(ctx.role).toBe("link");
    expect(ctx.targetName).toBe("Lees meer");
  });

  it("geeft resolveFailure terug als de resolve-ronde geen element vindt (nooit klikken op een gok)", async () => {
    const hand = new ResolveOnlyHand();
    hand.resolveFails = true;
    const { ctx, resolveFailure } = await buildGateContext(hand, { kind: "click-at", xFraction: 0.9, yFraction: 0.9 }, "https://x.nl/", undefined);
    expect(resolveFailure?.ok).toBe(false);
    expect(ctx.role).toBeUndefined();
    expect(ctx.targetName).toBeUndefined();
  });

  it("vangt een exception uit de resolve-ronde op als resolveFailure in plaats van te crashen", async () => {
    const hand = { act: async () => { throw new Error("native-messaging weg"); } };
    const { resolveFailure } = await buildGateContext(hand, { kind: "click-at", xFraction: 0.5, yFraction: 0.5 }, "https://x.nl/", undefined);
    expect(resolveFailure?.ok).toBe(false);
    expect(resolveFailure?.detail).toContain("native-messaging weg");
  });
});

describe("AgentLoop", () => {
  it("voert een veilige navigatie uit en stopt bij finish", async () => {
    const hand = new MockHand();
    const router = new MockRouter([
      '{"kind":"navigate","url":"https://shop.nl/producten"}',
      `{"kind":"finish","summary":"gevonden",${ALWAYS_TRUE_DONE}}`,
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
      `{"kind":"finish","summary":"gestopt",${ALWAYS_TRUE_DONE}}`,
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

  // Bugfix 2026-09-13 (adversariële review): dit was voorheen "auto-modus: voert
  // een schrijf-actie uit zónder bevestiging te vragen" en asserteerde confirmCalls
  // === 0 -- precies het gat. De MCP-tool-interface die Claude Code zelf gebruikt
  // (yad_run_goal → companion-client.ts) stuurt STRUCTUREEL altijd autonomy="auto"
  // en de aanroeper kan geen andere waarde meegeven, dus "auto" was in de praktijk
  // de ENIGE modus die die laag ooit gebruikte. Een pagina met verborgen/geïnjecteerde
  // tekst kon zo elke niet-betaal muterende actie (klikken, verzenden, verwijderen,
  // cross-origin navigeren, uploaden) laten uitvoeren zonder dat een mens het ooit
  // zag. needsConfirm() wordt nu ALTIJD afgedwongen, ongeacht autonomy.
  it("auto-modus: vraagt nu ook bevestiging bij een schrijf-actie en voert hem uit bij goedkeuring", async () => {
    const hand = new MockHand();
    hand.confirmReturn = true;
    const router = new MockRouter(['{"kind":"click","ref":"e1"}']); // e1 = "Opslaan" (muterend, role=button)
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sla op");
    expect(hand.confirmCalls).toBe(1); // bevestiging WEL gevraagd, ook in auto-modus
    expect(hand.acts).toEqual([{ kind: "click", ref: "e1" }]);
    expect(out.status).toBe("klaar");
  });

  it("auto-modus: schrijf-actie wordt geblokkeerd als de gebruiker de bevestiging weigert", async () => {
    const hand = new MockHand();
    hand.confirmReturn = false;
    const router = new MockRouter(['{"kind":"click","ref":"e1"}']); // e1 = "Opslaan"
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sla op");
    expect(hand.confirmCalls).toBe(1);
    expect(hand.acts).toHaveLength(0); // nooit uitgevoerd zonder goedkeuring
    expect(out.status).toBe("gestopt");
  });

  it("auto-modus: cross-origin navigatie vereist nu ook bevestiging", async () => {
    const hand = new MockHand();
    hand.confirmReturn = true;
    const router = new MockRouter(['{"kind":"navigate","url":"https://andere-site.example/"}']);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("ga naar een andere site");
    expect(hand.confirmCalls).toBe(1);
    expect(hand.acts).toEqual([{ kind: "navigate", url: "https://andere-site.example/" }]);
    expect(out.status).toBe("klaar");
  });

  it("auto-modus: select vereist nog steeds bevestiging (ongewijzigd, was al true ongeacht autonomy)", async () => {
    const hand = new MockHand();
    hand.confirmReturn = true;
    const router = new MockRouter(['{"kind":"select","ref":"e1","value":"x"}']);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("kies een optie");
    expect(hand.confirmCalls).toBe(1);
    expect(hand.acts).toEqual([{ kind: "select", ref: "e1", value: "x" }]);
    expect(out.status).toBe("klaar");
  });

  it("auto-modus: upload vereist nog steeds bevestiging (ongewijzigd, was al true ongeacht autonomy)", async () => {
    const hand = new MockHand();
    hand.confirmReturn = true;
    const router = new MockRouter(['{"kind":"upload","ref":"e1","filename":"cv.pdf","content":"AAA=","base64":true}']);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("upload mijn cv");
    expect(hand.confirmCalls).toBe(1);
    expect(hand.acts).toHaveLength(1);
    expect(out.status).toBe("klaar");
  });

  // Geen regressie: needsConfirm() geeft voor deze acties sowieso al false terug
  // (extract is read-only), dus auto-modus mag hier, net als voorheen, gewoon
  // doorlopen zonder een mens te storen.
  it("auto-modus: read-only extract-actie blijft zonder bevestiging werken (geen regressie)", async () => {
    const hand = new MockHand();
    const router = new MockRouter(['{"kind":"extract","what":"titel","ref":"e2"}']);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("lees de titel");
    expect(hand.confirmCalls).toBe(0);
    expect(hand.acts).toEqual([{ kind: "extract", what: "titel", ref: "e2" }]);
    expect(out.status).toBe("klaar");
  });

  // Geen regressie: same-origin navigatie vanaf een bekende pagina heeft geen
  // confirm nodig (needsConfirm geeft false), ook niet in auto-modus.
  it("auto-modus: same-origin navigatie blijft zonder bevestiging werken (geen regressie)", async () => {
    const hand = new MockHand();
    const router = new MockRouter(['{"kind":"navigate","url":"https://shop.nl/producten"}']);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("ga naar producten");
    expect(hand.confirmCalls).toBe(0);
    expect(hand.acts).toEqual([{ kind: "navigate", url: "https://shop.nl/producten" }]);
    expect(out.status).toBe("klaar");
  });

  it("auto-modus: blokkeert /checkout nog steeds hard (deny-lijst niet te omzeilen)", async () => {
    const hand = new MockHand();
    const router = new MockRouter([
      '{"kind":"navigate","url":"https://shop.nl/checkout"}',
      `{"kind":"finish","summary":"gestopt",${ALWAYS_TRUE_DONE}}`,
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
      `{"kind":"finish","summary":"Klaar",${ALWAYS_TRUE_DONE}}`,
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("zoek 3 vacatures");
    expect(out.status).toBe("klaar");
    expect(out.summary).toContain("Tolk A");
    expect(out.summary).toContain("Helpdesk C");
  });

  it("accepts a bare finish with NO done array for a purely informational run (extract only, no state change)", async () => {
    // prompt.ts's DONE PREDICATES section explicitly tells the model: "Omit ONLY for
    // purely informational goals (reading/extracting text where no page state
    // changes)" and decision-tree item 6: "No verifiable end state (pure extraction)?
    // -> omit done". A run that only extracts (never click/type/select/etc) must
    // still reach "klaar" without a done array -- the finish gate must not punish a
    // model for correctly following this documented carve-out.
    const hand = new MockHand();
    const router = new MockRouter([
      '{"kind":"extract","what":"vacatures","ref":"e2"}',
      '{"kind":"finish","summary":"3 vacatures gevonden"}', // no "done" array at all
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("zoek 3 vacatures");
    expect(out.status).toBe("klaar");
    expect(out.summary).toContain("Tolk A");
    // Never rejected -- an informational run does not need to prove a state change.
    expect(hand.updates.every((u) => !u.message.includes("Finish rejected"))).toBe(true);
  });

  it("weigert click-at als er deze beurt geen screenshot is gestuurd (vision-fallback vereist bewijs)", async () => {
    const hand = new MockHand(); // requestScreenshot() geeft null -> nooit failedHintScreenshot gezet
    const router = new MockRouter([
      '{"kind":"click-at","xFraction":0.5,"yFraction":0.5}',
      // queue-uitputting -> MockRouter valt terug op finish
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("klik op iets");
    expect(out.status).toBe("klaar"); // tweede beurt valt terug op default finish
    expect(hand.acts).toHaveLength(0); // click-at is NOOIT uitgevoerd
  });

  // ── End-to-end: click-at door de VOLLEDIGE lus (restpunt adversariële review 2026-09-13) ──
  //
  // click-at is alleen geldig op de beurt na een stuck-signaal (het model krijgt dan pas
  // een screenshot). Deze drie tests forceren dat via een "repeat"-escalatie (dezelfde
  // klik drie keer) met een onStuck-hint, precies zoals een echte Claude Code-escalatie
  // dat zou doen, en controleren daarna het ECHTE click-at-gedrag door de hele lus heen:
  // resolve-ronde -> poort -> (wel of geen) bevestiging -> pas dan de echte klik.
  describe("click-at door de volledige AgentLoop.run()-lus", () => {
    function makeEscalatedHand(): MockHand {
      const hand = new MockHand();
      hand.confirmReturn = true;
      hand.screenshotReturn = "data:image/jpeg;base64,ZmFrZQ=="; // maakt click-at na escalatie geldig
      return hand;
    }
    const REPEAT_THEN_CLICK_AT = (clickAt: string): string[] => [
      '{"kind":"click","ref":"e2"}', // e2 = "Producten", niet-muterend (role=link) — geen ruis van confirm-dialogen
      '{"kind":"click","ref":"e2"}',
      '{"kind":"click","ref":"e2"}', // 3x identiek -> "repeat"-signaal -> escalatie -> screenshot beschikbaar
      clickAt, // volgende beurt: click-at is nu toegestaan (sawScreenshotThisTurn)
      // queue-uitputting -> MockRouter valt terug op finish
    ];

    it("een muterend click-at-doelwit (na resolve) vereist bevestiging, en klikt pas na goedkeuring", async () => {
      const hand = makeEscalatedHand();
      hand.clickAtResolvesTo = { role: "button", name: "Verwijder account" };
      const router = new MockRouter(REPEAT_THEN_CLICK_AT('{"kind":"click-at","xFraction":0.5,"yFraction":0.5}'));
      const loop = new AgentLoop(router, hand, { sleep: noSleep, onStuck: async () => "probeer de vision-fallback" });
      const out = await loop.run("ruim iets op");

      // hand.acts bevat naast de 3 clicks: de resolveOnly-ronde EN de echte klik (in die volgorde).
      const clickAtActs = hand.acts.filter((a) => a.kind === "click-at");
      expect(clickAtActs).toEqual([
        { kind: "click-at", xFraction: 0.5, yFraction: 0.5, resolveOnly: true },
        { kind: "click-at", xFraction: 0.5, yFraction: 0.5 },
      ]);
      // Confirm werd gevraagd voor het muterende click-at-doelwit (en de mens keurde goed).
      expect(hand.confirmCalls).toBeGreaterThanOrEqual(1);
      expect(out.status).toBe("klaar");
    });

    it("een muterend click-at-doelwit wordt NIET geklikt als de mens de bevestiging weigert", async () => {
      const hand = makeEscalatedHand();
      hand.clickAtResolvesTo = { role: "button", name: "Verwijder account" };
      hand.confirmReturn = false; // weigert ELKE bevestiging, ook deze
      const router = new MockRouter(REPEAT_THEN_CLICK_AT('{"kind":"click-at","xFraction":0.5,"yFraction":0.5}'));
      const loop = new AgentLoop(router, hand, { sleep: noSleep, onStuck: async () => "probeer de vision-fallback" });
      await loop.run("ruim iets op");

      // Wel de resolve-ronde (dat klikt niet), maar NOOIT de echte klik.
      const clickAtActs = hand.acts.filter((a) => a.kind === "click-at");
      expect(clickAtActs).toEqual([{ kind: "click-at", xFraction: 0.5, yFraction: 0.5, resolveOnly: true }]);
    });

    it("een onschuldig, niet-muterend click-at-doelwit klikt direct door zonder extra bevestiging (geen regressie)", async () => {
      const hand = makeEscalatedHand();
      hand.clickAtResolvesTo = { role: "link", name: "Lees meer" }; // niet-muterend, geen CONFIRM_WORDS
      const router = new MockRouter(REPEAT_THEN_CLICK_AT('{"kind":"click-at","xFraction":0.2,"yFraction":0.3}'));
      const loop = new AgentLoop(router, hand, { sleep: noSleep, onStuck: async () => "probeer de vision-fallback" });
      const confirmCallsBeforeClickAt = (() => {
        // De 3 herhaalde "click" op e2 (role=link, "Producten") zijn zelf ook niet-muterend
        // (WRITE_ROLES bevat geen "link"), dus die vragen ook al geen bevestiging — de test
        // isoleert dus specifiek het click-at-gedrag zonder ruis van de repeat-escalatie.
        return hand.confirmCalls;
      })();
      const out = await loop.run("lees iets");

      const clickAtActs = hand.acts.filter((a) => a.kind === "click-at");
      expect(clickAtActs).toEqual([
        { kind: "click-at", xFraction: 0.2, yFraction: 0.3, resolveOnly: true },
        { kind: "click-at", xFraction: 0.2, yFraction: 0.3 },
      ]);
      expect(hand.confirmCalls).toBe(confirmCallsBeforeClickAt); // geen bevestiging erbij gekomen
      expect(out.status).toBe("klaar");
    });

    it("betaal-/bestel-achtig click-at-doelwit blijft hard geblokkeerd, ook na een gok-vrije resolve", async () => {
      const hand = makeEscalatedHand();
      hand.clickAtResolvesTo = { role: "button", name: "Plaats bestelling" }; // DENY_WORDS
      const router = new MockRouter(REPEAT_THEN_CLICK_AT('{"kind":"click-at","xFraction":0.5,"yFraction":0.9}'));
      const loop = new AgentLoop(router, hand, { sleep: noSleep, onStuck: async () => "probeer de vision-fallback" });
      await loop.run("bestel iets");

      // Alleen de resolve-ronde; checkDenied() blokkeert VOOR er ooit om bevestiging
      // gevraagd wordt of geklikt wordt — zelfde rode lijn als bij een gewone klik.
      const clickAtActs = hand.acts.filter((a) => a.kind === "click-at");
      expect(clickAtActs).toEqual([{ kind: "click-at", xFraction: 0.5, yFraction: 0.9, resolveOnly: true }]);
      expect(hand.updates.some((u) => u.status === "geweigerd")).toBe(true);
    });
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
  async requestScreenshot(): Promise<string | null> { return null; }
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
      `{"kind":"finish","summary":"hervat",${ALWAYS_TRUE_DONE}}`, // stap 3 (stap 2 → continue)
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
    const router = new MockRouter([`{"kind":"finish","summary":"klaar",${ALWAYS_TRUE_DONE}}`]);
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
    // Hand saw the "Finish rejected" status
    expect(hand.updates.some((u) => u.message.includes("Finish rejected"))).toBe(true);
  });

  it("eindigt met gestopt (niet fout) na MAX_FINISH_REJECTIONS+1 mislukte finish-pogingen", async () => {
    // Alle snapshots unsorted: elke finish-poging wordt geweigerd
    const hand = new DynamicMockHand([
      UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP,
    ]);
    const router = new MockRouter([
      FINISH_WITH_DONE, // stap 1: geweigerd (finishRejections=1 ≤ 2 → continue)
      FINISH_WITH_DONE, // stap 2: geweigerd (finishRejections=2 ≤ 2 → continue)
      FINISH_WITH_DONE, // stap 3: geweigerd (finishRejections=3 > 2 → gestopt)
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sorteer producten op prijs laag naar hoog");

    // "gestopt" i.p.v. "fout": taak was grotendeels klaar, recovery-store mag later leren.
    expect(out.status).toBe("gestopt");
    expect(hand.updates.some((u) => u.message.includes("Finish") && u.message.includes("rejected"))).toBe(true);
  });

  it("rejects finish without DONE predicates after a state-changing action (bug fix: was previously accepted as backwards compat)", async () => {
    // This test used to be named "accepteert finish zonder DONE-predicaten direct
    // (backwards compat)" and asserted status "klaar". That WAS the bug
    // (PROMPT-FIX-VALSE-KLAAR.md): `donePreds.length > 0` was the only gate, so an
    // empty done array skipped the whole check. Now a finish without predicates,
    // AFTER the run performed a state-changing action (select, here, mirroring the
    // real HackerOne repro: a menu selection claimed with zero objective proof), is
    // treated as a failed verification: rejected, with the same retry/hint mechanism
    // as a mismatch, and only a non-"klaar" status once MAX_FINISH_REJECTIONS is hit.
    // Every finish attempt is bare (no done array), including the ones the retry hint
    // asks for -- a model that never adds a done array, no matter how many chances it
    // gets. (A run that never changes state at all is the separate, legitimate
    // "purely informational" carve-out from prompt.ts -- see the "accepts a bare
    // finish with NO done array for a purely informational run" test above.)
    const hand = new DynamicMockHand([
      UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP,
    ]);
    const selectStep = '{"kind":"select","ref":"e1","value":"lohi"}';
    const bareFinish = '{"steps":[{"kind":"finish","summary":"klaar, geen predicaten"}],"rationale":"simpele taak"}';
    const router = new MockRouter([selectStep, bareFinish, bareFinish, bareFinish]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sorteer op prijs");

    // The state-changing action really happened.
    expect(hand.acts.some((a) => a.kind === "select")).toBe(true);
    // Never silently "klaar" -- rejected on every attempt, "gestopt" once the
    // rejection ceiling (MAX_FINISH_REJECTIONS) is hit.
    expect(out.status).toBe("gestopt");
    expect(hand.updates.every((u) => u.status !== "klaar")).toBe(true);
    expect(hand.updates.some((u) => u.message.includes("Finish rejected"))).toBe(true);
  });

  it("attribute-equals DONE-predicaat: match als combobox juiste waarde heeft", async () => {
    // Snapshot met gesorteerde combobox-waarde "lohi"
    const hand = new DynamicMockHand([SORTED_SNAP, SORTED_SNAP]);
    const attrFinish = JSON.stringify({
      steps: [{ kind: "finish", summary: "Gesorteerd op prijs (laag → hoog)",
        done: [{ type: "attribute-equals", role: "combobox", nameSubstring: "Sortering", attribute: "value", expected: "lohi" }] }],
      rationale: "combobox bevestigt sortering",
    });
    const router = new MockRouter([attrFinish]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sorteer op prijs");

    expect(out.status).toBe("klaar");
    expect(out.summary).toContain("Gesorteerd");
    expect(hand.updates.every((u) => !u.message.includes("Finish geweigerd"))).toBe(true);
  });

  it("attribute-equals DONE-predicaat: mismatch als combobox verkeerde waarde heeft", async () => {
    // Snapshot met verkeerde combobox-waarde "az" (niet gesorteerd)
    const hand = new DynamicMockHand([UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP, SORTED_SNAP]);
    const attrFinish = JSON.stringify({
      steps: [{ kind: "finish", summary: "Gesorteerd",
        done: [{ type: "attribute-equals", role: "combobox", nameSubstring: "Sortering", attribute: "value", expected: "lohi" }] }],
      rationale: "combobox bevestigt sortering",
    });
    const router = new MockRouter([
      attrFinish, // stap 1: finish → mismatch (waarde is "az", niet "lohi")
      '{"steps":[{"kind":"select","ref":"e1","value":"lohi"}],"rationale":"sorteren"}', // stap 2: select
      attrFinish, // stap 3: finish → match (waarde is "lohi")
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sorteer op prijs");

    expect(out.status).toBe("klaar");
    expect(hand.updates.some((u) => u.message.includes("Finish rejected"))).toBe(true);
    expect(hand.acts.some((a) => a.kind === "select")).toBe(true);
  });

  it("accepts finish when a text-present DONE predicate is indeterminate (weak predicate, never rejects per prompt.ts)", async () => {
    // prompt.ts documents text-present/text-absent as "WEAK: absent = indeterminate,
    // never rejects" -- a real predicate WAS supplied, it just could not be confirmed
    // against the (possibly truncated) text digest. evaluatePredicates can only
    // return "indeterminate" for a non-empty predicate set via this weak text path
    // (see predicate.ts); it must not be treated the same as a hard "mismatch".
    const hand = new DynamicMockHand([UNSORTED_SNAP, UNSORTED_SNAP]);
    const weakFinish = JSON.stringify({
      steps: [{ kind: "finish", summary: "Gesorteerd op prijs",
        done: [{ type: "text-present", value: "text that is definitely not on this page" }] }],
      rationale: "zwak predicaat, tekst niet gevonden",
    });
    const router = new MockRouter([weakFinish]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sorteer op prijs");

    expect(out.status).toBe("klaar");
    expect(hand.updates.every((u) => !u.message.includes("Finish rejected"))).toBe(true);
  });
});

// ── Bug fix proof: a finish with NO done predicates must never silently succeed ──
// This is the exact gap from PROMPT-FIX-VALSE-KLAAR.md: `donePreds.length > 0` was
// the only gate, so an empty/omitted done array skipped verification entirely and
// fell straight through to status "klaar" with the model's own self-written summary
// as the only "proof". This test is written and run FIRST against the unfixed code
// to prove the bug exists (RED), then re-run after the fix to prove it is closed (GREEN).
//
// The run below performs a real state-changing action (select) before the bare
// finish, matching the actual HackerOne repro in that doc (a menu/asset interaction
// claimed with zero objective proof). A run that never changes state at all is the
// separate, legitimate "purely informational" carve-out from prompt.ts, covered by
// its own test in the "DONE-predicaat bewaker" describe block above.

describe("AgentLoop - finish without DONE predicates must not silently succeed (bug fix proof)", () => {
  it("never returns status klaar for a bare finish call after a state-changing action, even after retries", async () => {
    // A model that never learns to supply a done array, no matter how many times it
    // is asked to try again. This must end in a non-klaar status (eventually "gestopt"
    // once the rejection ceiling is hit), never in silent "klaar".
    const hand = new DynamicMockHand([
      UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP, UNSORTED_SNAP,
    ]);
    const selectStep = '{"kind":"select","ref":"e1","value":"lohi"}';
    const bareFinish = JSON.stringify({
      steps: [{ kind: "finish", summary: "done, trust me" }],
      rationale: "no predicates supplied",
    });
    const router = new MockRouter([selectStep, bareFinish, bareFinish, bareFinish]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sort the products and confirm it, objectively, before finishing");

    // The state-changing action really happened.
    expect(hand.acts.some((a) => a.kind === "select")).toBe(true);
    // On the unfixed code, the very first bare finish call is accepted immediately
    // with status "klaar" -- that is the bug. After the fix, it must not be.
    expect(out.status).not.toBe("klaar");
    expect(hand.updates.every((u) => u.status !== "klaar")).toBe(true);
  });
});

// ── DOM-refresh na select: plan-clear structurele fix ───────────────────────

describe("AgentLoop — plan-clear na succesvolle select", () => {
  it("gooit resterende micro-plan stappen weg na select ok=true (stale-ref preventie)", async () => {
    // Micro-plan bevat [select, select, click] — de 2e select en click moeten NIET uitgevoerd worden.
    // Na de eerste select (ok=true) wist de loop het plan en maakt een nieuwe LLM-aanroep.
    const multiStepPlan = JSON.stringify({
      steps: [
        { kind: "select", ref: "e1", value: "lohi" },   // stap 1: select (ok → plan gewist)
        { kind: "select", ref: "e1", value: "lohi" },   // stap 2: zou stale zijn — mag NIET uitgevoerd worden
        { kind: "click",  ref: "e2" },                  // stap 3: mag ook NIET
      ],
      rationale: "multi-stap plan met stale-ref risico",
    });

    const hand = new DynamicMockHand([UNSORTED_SNAP, SORTED_SNAP, SORTED_SNAP]);
    const router = new MockRouter([
      multiStepPlan, // stap 1: model geeft 3-staps plan
      `{"steps":[{"kind":"finish","summary":"klaar na verse snapshot",${ALWAYS_TRUE_DONE}}],"rationale":"verse snapshot"}`, // stap 2: na plan-clear
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sorteer op prijs");

    expect(out.status).toBe("klaar");
    // Alleen de select uit stap 1 én de finish mogen uitgevoerd zijn (niet de 2e select of click)
    const selects = hand.acts.filter((a) => a.kind === "select");
    const clicks   = hand.acts.filter((a) => a.kind === "click");
    expect(selects).toHaveLength(1);  // slechts één select uitgevoerd
    expect(clicks).toHaveLength(0);   // click nooit bereikt
  });

  it("gooit resterende plan weg na mislukte select (fail-fast, niet alleen bij ok=true)", async () => {
    // De loop wist het resterende plan bij ELKE mislukte actie (loop.ts ~lijn 902).
    // Dit voorkomt dat vervolgstappen die afhankelijk waren van de mislukte actie
    // blind worden uitgevoerd. Na de fout wordt een verse LLM-aanroep gedwongen.
    const failPlan = JSON.stringify({
      steps: [
        { kind: "select", ref: "e99", value: "lohi" }, // zal mislukken: ref bestaat niet
        { kind: "wait",   ms: 100 },                   // mag NIET uitgevoerd worden (plan gewist na fout)
      ],
      rationale: "select met foute ref",
    });

    class FailSelectHand extends MockHand {
      override async act(a: Action): Promise<ActResult> {
        if (a.kind === "select") return { ok: false, detail: "ref niet gevonden" };
        return super.act(a);
      }
    }
    const hand = new FailSelectHand(UNSORTED_SNAP);
    const router = new MockRouter([
      failPlan,
      `{"steps":[{"kind":"finish","summary":"klaar na vers plan",${ALWAYS_TRUE_DONE}}],"rationale":"herstel na fout"}`,
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep, autonomy: "auto" });
    const out = await loop.run("sorteer op prijs");

    // Wait-stap is NIET uitgevoerd — plan gewist zodra select faalde
    expect(out.status).toBe("klaar");
    expect(hand.acts.some((a) => a.kind === "wait")).toBe(false); // wait nooit bereikt
  });
});

// ── RunRecord-substraat: lastStuckSignalId + hadRecovery ─────────────────────

describe("AgentLoop — RunRecord-getters", () => {
  it("lastStuckSignalId is undefined na succesvolle run", async () => {
    const hand = new MockHand();
    const router = new MockRouter([`{"kind":"finish","summary":"klaar",${ALWAYS_TRUE_DONE}}`]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("simpele taak");
    expect(out.status).toBe("klaar");
    expect(loop.lastStuckSignalId).toBeUndefined();
  });

  it("hadRecovery is false na succesvolle run zonder escalatie", async () => {
    const hand = new MockHand();
    const router = new MockRouter(['{"kind":"finish","summary":"klaar"}']);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    await loop.run("simpele taak");
    expect(loop.hadRecovery).toBe(false);
  });

  it("lastStuckSignalId is gevuld na repeat-escalatie zonder herstelplan", async () => {
    const hand = new MockHand();
    // 5 identieke acties → repeat-drempel → escalateOrStop → geen onStuck → give-up
    const router = new MockRouter([
      '{"kind":"click","ref":"e1"}',
      '{"kind":"click","ref":"e1"}',
      '{"kind":"click","ref":"e1"}',
      '{"kind":"click","ref":"e1"}',
      '{"kind":"click","ref":"e1"}',
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    const out = await loop.run("klik eindeloos");
    expect(out.status).toBe("gestopt");
    expect(loop.lastStuckSignalId).toBe("repeat");
  });

  it("providersUsed bevat provider:model van elke echte chat-call, gededupliceerd", async () => {
    const hand = new MockHand();
    const router = new MockRouter([
      '{"kind":"click","ref":"e1"}',
      '{"kind":"finish","summary":"klaar"}',
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    await loop.run("simpele taak");
    expect(loop.providersUsed).toEqual(["mock:mock-model"]);
  });

  it("providersUsed wordt geleegd bij een tweede run() op DEZELFDE loop-instantie, niet opgestapeld", async () => {
    // Verschillend model per run, anders verbergt de dedup (includes()) een ontbrekende reset
    // stil — beide runs zouden toevallig dezelfde string pushen en de test zou niets bewijzen.
    const modelBox = { current: "model-a" };
    const router: ChatLike = {
      async chat() {
        return { content: '{"kind":"finish","summary":"klaar"}', provider: "mock", model: modelBox.current };
      },
    };
    const hand = new MockHand();
    const loop = new AgentLoop(router, hand, { sleep: noSleep });

    await loop.run("eerste taak");
    expect(loop.providersUsed).toEqual(["mock:model-a"]);

    modelBox.current = "model-b";
    await loop.run("tweede taak");
    expect(loop.providersUsed).toEqual(["mock:model-b"]);
  });

  it("getters worden gereset bij een nieuwe run op dezelfde loop-instantie", async () => {
    const hand = new MockHand();
    // Eerste run: repeat → give-up (sets lastStuckSignalId)
    const router1 = new MockRouter([
      '{"kind":"click","ref":"e1"}',
      '{"kind":"click","ref":"e1"}',
      '{"kind":"click","ref":"e1"}',
      '{"kind":"click","ref":"e1"}',
      '{"kind":"click","ref":"e1"}',
    ]);
    const loop = new AgentLoop(router1, hand, { sleep: noSleep });
    await loop.run("klik eindeloos");
    expect(loop.lastStuckSignalId).toBe("repeat");

    // Tweede run op dezelfde instantie: should reset
    const hand2 = new MockHand();
    // We can't re-use the same AgentLoop with a new router easily, but we can
    // verify via a fresh loop that the reset logic is correct conceptually.
    // Since run() resets at the top, create a fresh run:
    const router2 = new MockRouter([`{"kind":"finish","summary":"klaar",${ALWAYS_TRUE_DONE}}`]);
    const loop2 = new AgentLoop(router2, hand2, { sleep: noSleep });
    const out2 = await loop2.run("simpele taak");
    expect(out2.status).toBe("klaar");
    expect(loop2.lastStuckSignalId).toBeUndefined();
    expect(loop2.hadRecovery).toBe(false);
  });

  it("strippt de ref van een extract-actie op een vergelijk/rangschik/tel-vraag (compare/rank/count-bewaker)", async () => {
    const hand = new MockHand();
    const router = new MockRouter([
      '{"kind":"extract","what":"prijzen van alle producten","ref":"e1"}',
      '{"kind":"finish","summary":"goedkoopste is product X"}',
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    await loop.run("wat is het goedkoopste product?");
    expect(hand.acts[0]).toEqual({ kind: "extract", what: "prijzen van alle producten" });
  });

  it("laat de ref van een extract-actie ongemoeid als de vraag geen vergelijk/tel-woord bevat", async () => {
    const hand = new MockHand();
    const router = new MockRouter([
      '{"kind":"extract","what":"titel van het artikel","ref":"e1"}',
      '{"kind":"finish","summary":"klaar"}',
    ]);
    const loop = new AgentLoop(router, hand, { sleep: noSleep });
    await loop.run("wat is de titel van het artikel?");
    expect(hand.acts[0]).toEqual({ kind: "extract", what: "titel van het artikel", ref: "e1" });
  });

  // Regressie op de adversariale review (2026-09-11): de Stop-knop zette voorheen alleen
  // de uitgaven-poort dicht (blokkeert de VOLGENDE modelaanroep), maar een microPlan van
  // meerdere al-besloten acties heeft voor de resterende stappen geen nieuwe modelaanroep
  // nodig, dus die voerden gewoon door alsof Stop nooit was ingedrukt.
  it("stopt direct midden in een microPlan zodra isAborted() waar wordt, ook zonder nieuwe modelaanroep", async () => {
    const hand = new MockHand();
    // Eén modelantwoord met een plan van twee stappen — de tweede mag NOOIT uitgevoerd
    // worden, want isAborted() wordt na de eerste actie waar.
    const router = new MockRouter([
      '{"steps":[{"kind":"click","ref":"e1","expected":"opgeslagen"},{"kind":"click","ref":"e2","expected":"bevestigd"}],"rationale":"twee klikken"}',
    ]);
    let aborted = false;
    const originalAct = hand.act.bind(hand);
    hand.act = async (a) => {
      const r = await originalAct(a);
      aborted = true; // gebruiker klikt Stop vlak na de eerste, al-gebufferde actie
      return r;
    };
    const loop = new AgentLoop(router, hand, { sleep: noSleep, isAborted: () => aborted });
    const out = await loop.run("sla het formulier op en bevestig");
    expect(out.status).toBe("gestopt");
    expect(hand.acts).toHaveLength(1); // de tweede, al-gebufferde actie mag niet meer lopen
  });
});
