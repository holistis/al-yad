/**
 * Regressietest voor de CDP-levenscyclus van PlaywrightHand (2026-09-15/16-audit vond:
 * "geen enkele test dekt het CDP-codepad zelf" — close()-veiligheid en het altijd-
 * nieuw-tabblad-gedrag waren tot nu toe alleen HANDMATIG bewezen tegen de echte Chrome
 * van de koning, niet automatisch).
 *
 * Start een ECHTE, controleerbare Chromium met een eigen --remote-debugging-port
 * (naast Playwright's eigen besturingskanaal — die twee botsen niet, het zijn losse
 * transporten voor hetzelfde CDP-protocol), en verbindt daarmee een TWEEDE
 * PlaywrightHand via cdpEndpoint, exact zoals main-server.ts dat met de echte,
 * ingelogde Chrome van de koning doet. Geen mock: een mock zou alleen bewijzen dat de
 * mock zich gedraagt zoals verwacht.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { PlaywrightHand } from "./playwright-hand.js";

const CDP_PORT = 9333;
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;

describe("PlaywrightHand — CDP-modus levenscyclus (init/close/tabbladveiligheid)", () => {
  let outerBrowser: Browser;

  beforeAll(async () => {
    outerBrowser = await chromium.launch({
      headless: true,
      args: [`--remote-debugging-port=${CDP_PORT}`],
    });
  }, 30_000);

  afterAll(async () => {
    await outerBrowser.close().catch(() => {});
  });

  it("raakt een AL BESTAAND tabblad nooit aan en opent altijd zijn eigen, nieuwe tabblad", async () => {
    const ctx = outerBrowser.contexts()[0] ?? (await outerBrowser.newContext());
    const preExisting = await ctx.newPage();
    await preExisting.goto("data:text/html,<title>PRIVE-TABBLAD</title><body>geheime inhoud</body>");

    const hand = new PlaywrightHand({ cdpEndpoint: CDP_ENDPOINT });
    await hand.init();
    const snap = await hand.requestSnapshot();

    // De snapshot hoort van het NIEUWE, eigen tabblad te zijn (leeg), niet van het
    // al-bestaande "prive" tabblad — en dat prive-tabblad moet exact ongewijzigd
    // blijven, zowel qua URL als qua titel (bewijst dat het nooit gelezen/geopend is).
    // (Geen page-count-check hier: een TWEEDE, onafhankelijke connectOverCDP()-
    // verbinding zoals de Hand hierboven gebruikt heeft zijn eigen objectgraaf, die
    // niet 1-op-1 doorwerkt in ctx.pages() van de EERSTE, buitenste verbinding.)
    expect(snap.url).toBe("about:blank");
    expect(preExisting.url()).toContain("data:text/html");
    expect(await preExisting.title()).toBe("PRIVE-TABBLAD");

    await hand.close();
    expect(preExisting.isClosed()).toBe(false); // hand.close() raakte dit tabblad niet
    await preExisting.close();
  }, 20_000);

  it("close() sluit NOOIT de hele browser — de buitenste, echte browser blijft in leven", async () => {
    const hand = new PlaywrightHand({ cdpEndpoint: CDP_ENDPOINT });
    await hand.init();
    await hand.act({ kind: "navigate", url: "data:text/html,<title>tussenstap</title>" });
    await hand.close();

    // Het enige harde bewijs dat de buitenste browser nog leeft: hij kan nog gewoon
    // een nieuwe pagina openen en navigeren. Was browser.close() aangeroepen, dan zou
    // dit hele blok een "Target closed"/"Browser closed"-fout gooien.
    const ctx = outerBrowser.contexts()[0]!;
    const proof = await ctx.newPage();
    await proof.goto("data:text/html,<title>nog in leven</title>");
    expect(await proof.title()).toBe("nog in leven");
    await proof.close();
  }, 20_000);

  it("act() en requestSnapshot() werken echt over de CDP-verbinding, niet alleen init()", async () => {
    const hand = new PlaywrightHand({ cdpEndpoint: CDP_ENDPOINT });
    await hand.init();
    await hand.act({
      kind: "navigate",
      url: `data:text/html,<title>CDP-werkt</title><button id="b">Klik</button>`,
    });
    const snap = await hand.requestSnapshot();
    const btn = snap.nodes.find((n) => n.name === "Klik");
    expect(btn).toBeDefined();
    const r = await hand.act({ kind: "click", ref: btn!.ref });
    expect(r.ok).toBe(true);
    await hand.close();
  }, 20_000);

  it("meerdere achtereenvolgende PlaywrightHand-instanties (zoals main-server.ts per request) hinderen elkaar niet", async () => {
    for (let i = 0; i < 3; i++) {
      const hand = new PlaywrightHand({ cdpEndpoint: CDP_ENDPOINT });
      await hand.init();
      await hand.act({ kind: "navigate", url: `data:text/html,<title>run-${i}</title>` });
      const snap = await hand.requestSnapshot();
      expect(snap.title).toBe(`run-${i}`);
      await hand.close();
    }
    // De buitenste browser overleeft alle drie de opeenvolgende runs.
    const ctx = outerBrowser.contexts()[0]!;
    const proof = await ctx.newPage();
    await proof.goto("data:text/html,<title>overleefd</title>");
    expect(await proof.title()).toBe("overleefd");
    await proof.close();
  }, 30_000);
});
