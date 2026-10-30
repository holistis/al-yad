/**
 * Regressietest voor de frame-bewuste snapshot/act-uitbreiding van PlaywrightHand
 * (2026-09-15): bewijst dat een element in een ECHTE cross-origin iframe zowel
 * zichtbaar wordt in de snapshot als daadwerkelijk aanklikbaar is via act().
 *
 * Twee lokale HTTP-servers op verschillende hostnamen (127.0.0.1 vs localhost)
 * simuleren cross-origin: verschillende host-strings zijn voor de browser een
 * ander origin, ook al wijzen beide naar hetzelfde loopback-adres. Dat volstaat
 * om Playwright's frame-API (page.frames(), frame.locator()) op dezelfde manier
 * te oefenen als bij een echte cross-origin widget (bv. een Atlassian Forge-app
 * op cdn.prod.atlassian-dev.net) — zie memory yad-atlassian-marketplace-site-
 * picker-niet-automatiseerbaar-2026-09-15.md voor het oorspronkelijke gat.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { PlaywrightHand } from "./playwright-hand.js";

function startServer(html: () => string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html());
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

const INNER_HTML = `<!doctype html><html><body>
<button id="inner-btn" onclick="this.textContent='CLICKED'">Inner Iframe Knop</button>
</body></html>`;

describe("PlaywrightHand — cross-origin iframe (frame-bewuste snapshot/act)", () => {
  let outer: { server: Server; port: number };
  let inner: { server: Server; port: number };
  let hand: PlaywrightHand;

  beforeAll(async () => {
    inner = await startServer(() => INNER_HTML);
    outer = await startServer(
      () => `<!doctype html><html><body>
<button id="outer-btn">Outer Hoofdpagina Knop</button>
<iframe src="http://localhost:${inner.port}/" style="width:400px;height:200px;border:1px solid #000"></iframe>
</body></html>`,
    );
    hand = new PlaywrightHand({ headless: true });
    await hand.init();
    await hand.act({ kind: "navigate", url: `http://127.0.0.1:${outer.port}/` });
  }, 30_000);

  afterAll(async () => {
    await hand.close();
    outer.server.close();
    inner.server.close();
  });

  it("ziet elementen in zowel het hoofdframe als de cross-origin iframe", async () => {
    const snap = await hand.requestSnapshot();
    const outerBtn = snap.nodes.find((n) => n.name.includes("Outer Hoofdpagina Knop"));
    const innerBtn = snap.nodes.find((n) => n.name.includes("Inner Iframe Knop"));
    expect(outerBtn).toBeDefined();
    expect(innerBtn).toBeDefined();
    // Hoofdframe-refs beginnen met "f0:"; de iframe-knop moet een ANDER frame-nummer hebben.
    expect(outerBtn!.ref).toMatch(/^f0:/);
    expect(innerBtn!.ref).not.toMatch(/^f0:/);
  });

  it("kan ECHT klikken op een element binnen de cross-origin iframe", async () => {
    const before = await hand.requestSnapshot();
    const innerBtn = before.nodes.find((n) => n.name.includes("Inner Iframe Knop"));
    expect(innerBtn).toBeDefined();

    const result = await hand.act({ kind: "click", ref: innerBtn!.ref });
    expect(result.ok).toBe(true);

    const after = await hand.requestSnapshot();
    const clicked = after.nodes.find((n) => n.ref === innerBtn!.ref);
    expect(clicked?.name).toContain("CLICKED");
  });

  it("laat het hoofdframe ongemoeid werken naast de iframe-ondersteuning", async () => {
    const snap = await hand.requestSnapshot();
    const outerBtn = snap.nodes.find((n) => n.name.includes("Outer Hoofdpagina Knop"));
    expect(outerBtn).toBeDefined();
    const result = await hand.act({ kind: "click", ref: outerBtn!.ref });
    expect(result.ok).toBe(true);
  });

  it("weigert een verzonnen ref met een aanhalingsteken erin (CSS-selector-injectie via prompt-injectie)", async () => {
    // Simuleert wat een door prompt-injectie beïnvloede LLM-agent zou kunnen "verzinnen"
    // i.p.v. een echte ref uit de snapshot — mag NOOIT in de CSS-selector belanden.
    const result = await hand.act({ kind: "click", ref: `f0:e1"],button:has-text("Connect Wallet` });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/ongeldige ref/i);
  });

  it("weigert een ref met een frame-index die niet (meer) in de cache zit, i.p.v. stil terug te vallen op het hoofdframe", async () => {
    const result = await hand.act({ kind: "click", ref: "f99:e1" });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/frame 99 niet meer bekend/i);
  });
});
