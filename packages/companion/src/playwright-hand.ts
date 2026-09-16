/**
 * PlaywrightHand — HandBridge implementatie zonder Chrome-extensie.
 *
 * Gebruikt Playwright Chromium als browser-hand. Hiermee kan Claude (of een
 * script) het Brein aansturen zonder dat een mens een browser open heeft staan.
 *
 * Snapshot-mechanisme:
 *   - Wij evalueren JavaScript in de pagina om alle interacteerbare elementen
 *     te vinden en kennen elk een stabiele `data-yad-ref` toe.
 *   - Bij act() zoeken we het element via `[data-yad-ref="${ref}"]`.
 *   - textDigest = eerste 3000 tekens van body.innerText.
 *
 * Confirm-gedrag:
 *   - headless=true (standaard): schrijf-acties worden gelogd en terugverwezen
 *     aan de caller via de `onConfirm`-callback. Standaard auto-approve voor
 *     bug-bounty recon (readonly). De ScopeGuard blokkeert toch alles gevaarlijks.
 */
import { chromium, type Browser, type Page, type Frame } from "playwright";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, ActResult, RunStatus, Snapshot, SnapshotNode } from "@yad/shared";
import { normalizeText, SNAPSHOT_LIMITS } from "@yad/shared";
import type { HandBridge } from "./agent/loop.js";

export interface PlaywrightHandOptions {
  headless?: boolean;
  /** ms te wachten na navigatie voordat snapshot wordt genomen (voor JS-zware SPAs) */
  spaWaitMs?: number;
  /** callback voor bevestigingsverzoeken; standaard auto-goedkeuren */
  onConfirm?: (action: Action, reason: string) => Promise<boolean>;
  /** log-functie voor voortgang */
  log?: (m: string) => void;
  /** cookies die geïnjecteerd moeten worden bij de eerste navigatie */
  cookies?: Array<{ name: string; value: string; domain: string; path?: string }>;
  /** optioneel: map waarin Playwright een .webm-opname van de run wegschrijft (bv. voor demo's) */
  recordVideoDir?: string;
  /** optioneel: laat de muis zichtbaar naar het doelelement glijden vóór click/type (alleen voor demo-opnames) */
  demoCursor?: boolean;
  /** CDP-endpoint (bv. http://127.0.0.1:9222) van een AL DRAAIENDE, echte Chrome
   *  (gestart met --remote-debugging-port). Indien gezet: verbindt met die browser
   *  in plaats van een nieuwe, lege Chromium te starten, zodat de echte, ingelogde
   *  sessies van de gebruiker beschikbaar zijn. Opent altijd een NIEUW tabblad en
   *  raakt nooit een bestaand tabblad aan — zelfde privacyles als de 2026-09-07
   *  incident-fix in packages/extension (nooit blind meeliften op een tab die de
   *  gebruiker toevallig open heeft staan). */
  cdpEndpoint?: string;
}

/**
 * JavaScript dat in de pagina-context draait om de snapshot te bouwen. Dit is een
 * kale in-page `page.evaluate`-string, GEEN Playwright-locator — Playwright se
 * eigen locator-engine (page.locator(), gebruikt verderop voor act()) doorkruist
 * open shadow DOM automatisch, maar document.querySelectorAll() hier NIET. Zonder
 * de expliciete shadow-DOM-recursie hieronder blijft deze snapshot leeg op web-
 * component-apps (Adobe Firefly/Express e.d., zelfde onderliggende gat als
 * collectInteractive() in packages/extension/lib/perception.ts, 2026-09-12).
 */
// Geëxporteerd puur zodat playwright-hand.shadowDom.test.ts de shadow-DOM-doorkruising
// rechtstreeks in jsdom kan uittesten zonder een echte Playwright-browser te starten.
export const SNAPSHOT_SCRIPT = `(() => {
  const SELECTOR = [
    'a[href]', 'button', 'input:not([type="hidden"])',
    'select', 'textarea', '[role="button"]', '[role="link"]',
    '[role="checkbox"]', '[role="menuitem"]', '[role="tab"]',
    '[role="combobox"]', '[role="textbox"]',
    // option/listbox ontbraken hier: een geopend react-select-menu (of vergelijkbare
    // custom dropdown) was daardoor voor de agent onzichtbaar ook al werkte de klik
    // die 'm opende prima — bevestigd 2026-09-15 tegen de echte Atlassian Marketplace
    // site-picker (aria-expanded=true, 2 opties in de DOM, 0 in de snapshot).
    '[role="option"]', '[role="listbox"]',
  ].join(',');
  function collectDeep(root, out, budget) {
    root.querySelectorAll('*').forEach((el) => {
      if (budget.n-- <= 0) return;
      if (el.matches(SELECTOR)) out.push(el);
      if (el.shadowRoot) collectDeep(el.shadowRoot, out, budget);
    });
  }
  const allEls = [];
  collectDeep(document, allEls, { n: 4000 });
  const els = allEls.slice(0, ${SNAPSHOT_LIMITS.MAX_NODES});
  let idx = 1;
  const nodes = [];
  for (const el of els) {
    const ref = 'e' + idx++;
    el.setAttribute('data-yad-ref', ref);
    const explicitRole = el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    let role;
    if (explicitRole) role = explicitRole;
    else if (tag === 'a') role = 'link';
    else if (tag === 'button' || tag === 'summary') role = 'button';
    else if (tag === 'select') role = 'combobox';
    else if (tag === 'textarea') role = 'textbox';
    else if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') role = 'checkbox';
      else if (t === 'radio') role = 'radio';
      else if (t === 'button' || t === 'submit' || t === 'reset') role = 'button';
      else if (t === 'file') role = 'file-input';
      else role = 'textbox';
    } else role = tag;
    const name = (
      el.getAttribute('aria-label') ||
      el.textContent?.trim().slice(0, 120) ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      ''
    );
    nodes.push({
      ref,
      role,
      name,
      value: el.value || undefined,
      disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined,
    });
  }
  return nodes;
})()`;

/**
 * JavaScript dat de zichtbare paginatekst ophaalt, met dezelfde shadow-DOM-recursie
 * als SNAPSHOT_SCRIPT hierboven. Geëxporteerd voor playwright-hand.shadowDom.test.ts.
 */
export const TEXT_DIGEST_SCRIPT = `(function() {
  function deepText(root, budget) {
    const parts = [
      root === document
        ? (document.body?.innerText || '')
        : ((root.textContent || '').replace(/\\s+/g, ' ')),
    ];
    root.querySelectorAll('*').forEach((el) => {
      if (budget.n-- <= 0) return;
      if (el.shadowRoot) parts.push(deepText(el.shadowRoot, budget));
    });
    return parts.filter(Boolean).join('\\n');
  }
  const main = document.querySelector('main, [role="main"], article');
  if (main) {
    const t = (main.innerText || '').trim();
    if (t.length > 300) return t;
  }
  return deepText(document, { n: 4000 });
})()`;

/**
 * In-page functie voor click-at's resolveOnly-modus: zoekt het element op (x, y) op en
 * geeft rol + toegankelijke naam terug ZONDER te klikken — dezelfde, bewust simpele
 * rol-berekening die SNAPSHOT_SCRIPT hierboven al gebruikt (geen import mogelijk in een
 * page.evaluate-context). Nul (`null`) betekent: niets gevonden op die positie.
 *
 * Zonder deze functie zou de resolveOnly-ronde die loop.ts nu voor ELKE click-at
 * aanvraagt (packages/companion/src/agent/loop.ts, buildGateContext) hier gewoon
 * meteen op `page.mouse.click()` in de click-at-tak hieronder terechtkomen — een
 * ECHTE klik voor de "peiling", gevolgd door een TWEEDE echte klik na goedkeuring.
 *
 * Geëxporteerd zodat playwright-hand.clickAtResolve.test.ts 'm rechtstreeks in jsdom
 * kan aanroepen, zelfde patroon als SNAPSHOT_SCRIPT/TEXT_DIGEST_SCRIPT hierboven.
 */
/** Minimale vorm van een DOM-element — dit bestand draait onder Node (geen "dom" lib),
 *  terwijl deze functie zelf enkel in de pagina-context wordt uitgevoerd (via
 *  page.evaluate). Zelfde workaround als de bestaande scroll-actie hieronder. */
interface MinimalElement {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  tagName: string;
  textContent: string | null;
  isContentEditable: boolean;
}

export function resolveClickAtTarget([x, y]: [number, number]): { role: string; name: string } | null {
  const doc = (globalThis as unknown as { document: { elementFromPoint(x: number, y: number): MinimalElement | null } }).document;
  const el = doc.elementFromPoint(x, y);
  if (!el) return null;
  const explicitRole = el.getAttribute("role");
  const tag = el.tagName.toLowerCase();
  let role: string;
  if (explicitRole) role = explicitRole;
  else if (tag === "a") role = "link";
  else if (tag === "button" || tag === "summary") role = "button";
  else if (tag === "select") role = "combobox";
  else if (tag === "textarea") role = "textbox";
  else if (tag === "input") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    if (t === "checkbox") role = "checkbox";
    else if (t === "radio") role = "radio";
    else if (t === "button" || t === "submit" || t === "reset") role = "button";
    else if (t === "file") role = "file-input";
    else role = "textbox";
  } else if (el.isContentEditable) role = "textbox";
  else if (el.hasAttribute("onclick")) role = "button";
  else role = tag;
  const name = (
    el.getAttribute("aria-label") ||
    (el.textContent || "").trim().slice(0, 120) ||
    el.getAttribute("placeholder") ||
    el.getAttribute("title") ||
    el.getAttribute("alt") ||
    ""
  ).trim();
  return { role, name };
}

export interface DemoTimelineEntry {
  label: string;
  tStartMs: number;
  tEndMs: number;
}

export class PlaywrightHand implements HandBridge {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private videoStartTs = 0;
  public readonly demoTimeline: DemoTimelineEntry[] = [];
  private readonly options: Required<Omit<PlaywrightHandOptions, "cookies" | "cdpEndpoint">> & {
    cookies?: PlaywrightHandOptions["cookies"];
    cdpEndpoint?: PlaywrightHandOptions["cdpEndpoint"];
  };
  private firstNav = true;
  /** Frame-index → Playwright Frame, opnieuw opgebouwd bij elke requestSnapshot(). Laat
   *  act() een ref uit een cross-origin sub-frame (bv. een Atlassian Forge-widget) terug-
   *  vertalen naar het juiste frame, i.p.v. altijd op het hoofdframe te zoeken. */
  private frameCache: Map<number, Frame> = new Map();

  constructor(opts: PlaywrightHandOptions = {}) {
    this.options = {
      headless: opts.headless ?? true,
      spaWaitMs: opts.spaWaitMs ?? 800,
      onConfirm: opts.onConfirm ?? (async () => true), // auto-goedkeuren (ScopeGuard blokkeert toch)
      log: opts.log ?? ((m) => console.log(`[playwright-hand] ${m}`)),
      cookies: opts.cookies,
      recordVideoDir: opts.recordVideoDir ?? "",
      demoCursor: opts.demoCursor ?? false,
      cdpEndpoint: opts.cdpEndpoint,
    };
  }

  /** Beweegt de muis zichtbaar naar het midden van een element (alleen actief met demoCursor). */
  private async glideTo(el: import("playwright").Locator): Promise<void> {
    if (!this.options.demoCursor || !this.page) return;
    const box = await el.boundingBox().catch(() => null);
    if (!box) return;
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
    // De zichtbare cursor-stip in de demo-pagina glijdt via een CSS-transition van 0.55s
    // (zie site/demo-sandbox.html #cursor). Korter wachten laat een klik/typ-actie
    // starten vóórdat de stip zichtbaar is aangekomen; langer wachten bouwt onnodige
    // stilstand op die de montage er later weer moet uitknippen.
    await this.page.waitForTimeout(450);
  }

  async init(): Promise<void> {
    if (this.options.cdpEndpoint) {
      // Verbind met een AL DRAAIENDE, echte Chrome via CDP i.p.v. een lege Chromium te
      // starten. Dit geeft volle Playwright-toegang (dus ook cross-origin sub-frames) op
      // de echte, ingelogde sessie van de gebruiker. Altijd een NIEUW tabblad — nooit een
      // bestaand tabblad "lenen", dat kan prive-inhoud lekken die de gebruiker toevallig
      // open had staan (zelfde les als de 2026-09-07 incident-fix in packages/extension).
      this.browser = await chromium.connectOverCDP(this.options.cdpEndpoint);
      let ctx = this.browser.contexts()[0];
      if (!ctx) {
        // 0 bestaande contexten is onverwacht voor een AL DRAAIENDE, ingelogde Chrome —
        // een nieuwe, lege context heeft GEEN cookies/login, precies het tegenovergestelde
        // van waar cdpEndpoint voor bedoeld is. Luid loggen i.p.v. dit stil te laten
        // gebeuren, zodat een write-actie niet onopgemerkt tegen een uitgelogde sessie
        // aanloopt (2026-09-15/16-audit).
        this.options.log(
          "WAARSCHUWING: CDP-verbinding gaf 0 bestaande browser-contexten terug — val terug op een NIEUWE, LEGE context zonder cookies/login. Dit is vrijwel zeker niet de bedoeling van cdpEndpoint.",
        );
        ctx = await this.browser.newContext();
      }
      this.page = await ctx.newPage();
      this.videoStartTs = Date.now();
      return;
    }
    this.browser = await chromium.launch({ headless: this.options.headless });
    const ctx = await this.browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      ...(this.options.recordVideoDir
        ? { recordVideo: { dir: this.options.recordVideoDir, size: { width: 1280, height: 800 } } }
        : {}),
    });
    this.page = await ctx.newPage();
    this.videoStartTs = Date.now();
  }

  /** Markeert een zichtbaar-actief venster in de demo-tijdlijn (alleen relevant met demoCursor). */
  private markDemo(label: string, tStartMs: number): void {
    if (!this.options.demoCursor) return;
    this.demoTimeline.push({ label, tStartMs, tEndMs: Date.now() - this.videoStartTs });
  }

  async close(): Promise<void> {
    if (this.options.cdpEndpoint) {
      // Verbonden met de ECHTE Chrome van de gebruiker via CDP: NOOIT browser.close()
      // aanroepen. Playwright's EIGEN documentatie zegt dat dit bij een connectOverCDP-
      // browser "alle door DEZE Browser aangemaakte contexten" opruimt en de verbinding
      // sluit — geen letterlijke "sluit de hele browser-app" zoals bij chromium.launch().
      // Maar init() hierboven HERGEBRUIKT een AL BESTAANDE context (contexts()[0], niet
      // zelf aangemaakt via newContext()), en of die meetelt als "door deze Browser
      // aangemaakt" staat nergens hard genoeg omschreven om daar het risico op te nemen
      // (2026-09-15/16-audit, expliciet uitgezocht, niet aangenomen). Sluit daarom alleen
      // het tabblad dat WIJ zelf openden in init(), en laat de rest — inclusief de
      // CDP-websocket-verbinding zelf, die niet expliciet wordt afgesloten — met rust.
      // Bekend, geaccepteerd compromis: bij zeer veel opeenvolgende runs kunnen er
      // meerdere onderliggende CDP-verbindingen open blijven staan (resource-gebruik,
      // geen veiligheidsrisico). Nooit "oplossen" door hier alsnog browser.close() te
      // gaan aanroepen zonder dit eerst zelf, empirisch, tegen een wegwerp-testprofiel
      // te verifiëren.
      await this.page?.close().catch(() => {});
      this.browser = null;
      this.page = null;
      return;
    }
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }

  /** Max. aantal frames (hoofdpagina + sub-frames) dat een snapshot doorzoekt. Begrensd
   *  zodat een pagina met tientallen advertentie/tracker-iframes de snapshot niet traag
   *  en ruizig maakt — precies de frames die een gebruiker wil (widgets, site-pickers)
   *  zitten vrijwel altijd in de eerste paar. */
  private static readonly MAX_FRAMES = 12;

  async requestSnapshot(): Promise<Snapshot> {
    const page = this.requirePage();
    const url = page.url();
    const title = await page.title().catch(() => "");

    const frames = page.frames();
    this.frameCache.clear();
    let nodes: SnapshotNode[] = [];
    let skippedFrames = 0;

    for (let i = 0; i < frames.length; i++) {
      if (nodes.length >= SNAPSHOT_LIMITS.MAX_NODES) {
        skippedFrames += frames.length - i;
        break;
      }
      if (i >= PlaywrightHand.MAX_FRAMES) {
        skippedFrames += frames.length - i;
        break;
      }
      const frame = frames[i]!;
      if (!frame.url() || frame.url() === "about:blank") continue; // lege/verborgen tracker-iframes
      this.frameCache.set(i, frame);
      try {
        // Frame-index vooraan in de ref gecodeerd ("f2:e5") zodat act() hieronder terug
        // weet in welk frame het element staat. SNAPSHOT_SCRIPT zelf blijft ONGEWIJZIGD
        // (produceert nog steeds kale "e5"-refs) — playwright-hand.shadowDom.test.ts
        // evalueert dat script rechtstreeks in jsdom en zou breken als de scriptstring
        // zelf een frame-prefix zou moeten kennen.
        const raw = (await frame.evaluate(SNAPSHOT_SCRIPT)) as SnapshotNode[];
        for (const n of raw) {
          nodes.push({
            ...n,
            ref: `f${i}:${n.ref}`,
            name: normalizeText(n.name).slice(0, SNAPSHOT_LIMITS.NAME_LIMIT),
            ...(n.value !== undefined ? { value: normalizeText(n.value).slice(0, SNAPSHOT_LIMITS.NAME_LIMIT) } : {}),
            // Zodat ScopeGuard een actie op dit element ook buiten navigate() om tegen de
            // toewijzingsdomeinen kan toetsen — zonder dit veld was een cross-origin iframe
            // (advertentie, gecompromitteerde widget) volledig buiten de scope-check om
            // bereikbaar zodra dit frame-bewuste snapshot 'm uberhaupt kon vinden.
            frameUrl: frame.url(),
          });
        }
      } catch {
        /* frame niet evalueerbaar (detached, nog aan het laden, about:blank-varianten) — overslaan */
      }
    }
    nodes = nodes.slice(0, SNAPSHOT_LIMITS.MAX_NODES);
    if (skippedFrames > 0) {
      this.options.log(`snapshot: ${skippedFrames} extra frame(s) overgeslagen (budget ${PlaywrightHand.MAX_FRAMES})`);
    }

    let textDigest = "";
    try {
      // Prefereer main-content boven volledige body — navigatie-blokken eten anders
      // de textDigest-limiet op voor de echte pagina-inhoud komt. Loopt daarna, net
      // als SNAPSHOT_SCRIPT hierboven, expliciet open shadow roots af: zonder die
      // recursie bleef dit altijd leeg op web-component-apps (2026-09-12).
      const raw = (await page.evaluate(TEXT_DIGEST_SCRIPT)) as string;
      textDigest = normalizeText(raw);
    } catch {
      /* negeer */
    }
    // Tekst uit cross-origin sub-frames erbij (bv. een chatwidget in een iframe die de
    // agent moet KUNNEN LEZEN, niet alleen erin kunnen klikken) — per frame begrensd
    // zodat één grote widget niet de hele digest opeet.
    for (let i = 1; i < frames.length && i < PlaywrightHand.MAX_FRAMES; i++) {
      const frame = frames[i]!;
      if (!frame.url() || frame.url() === "about:blank") continue;
      try {
        const raw = (await frame.evaluate(TEXT_DIGEST_SCRIPT)) as string;
        const t = normalizeText(raw).slice(0, 500);
        if (t) textDigest += `\n[iframe ${frame.url()}]\n${t}`;
      } catch {
        /* negeer */
      }
    }
    textDigest = textDigest.slice(0, SNAPSHOT_LIMITS.DIGEST_LIMIT);

    return { url, title: normalizeText(title), nodes, textDigest };
  }

  /** Een lokale ref (het deel na de dubbele punt) is ALTIJD 'e' + een getal — zo bouwt
   *  SNAPSHOT_SCRIPT 'm op. Een ref die daar niet aan voldoet komt niet uit onze eigen
   *  snapshot, bv. een LLM-agent die (via prompt-injectie in paginatekst) een ref
   *  "verzint" met een aanhalingsteken erin om uit de CSS-attribuutselector hieronder
   *  te breken. Zonder deze check zou zo'n ref een heel ander element kunnen raken dan
   *  bedoeld (2026-09-15/16-audit). */
  private static readonly SAFE_LOCAL_REF = /^e\d+$/;

  /** Vertaalt een snapshot-ref ("f2:e5") terug naar een Locator op het JUISTE frame.
   *  Zonder deze indirectie zou elke act()-tak hieronder altijd op het hoofdframe
   *  zoeken, en dus nooit een element in een cross-origin sub-frame vinden — exact
   *  het gat dat chrome.debugger niet kon dichten (zie memory yad-atlassian-
   *  marketplace-site-picker-niet-automatiseerbaar-2026-09-15.md). Playwright lost
   *  de onderliggende CDP-sessie-routing naar het sub-frame zelf op; wij hoeven
   *  alleen de juiste Frame door te geven.
   *
   *  Gooit een fout (afgevangen door de bestaande try/catch in act() hieronder, wordt
   *  dus gewoon een eerlijke { ok: false, detail } i.p.v. een crash) bij: een ref die
   *  niet aan het verwachte formaat voldoet, of een frame-index die niet meer in de
   *  cache zit (de pagina veranderde tussen de laatste requestSnapshot() en deze
   *  actie — vroeger viel dit stil terug op het hoofdframe, met kans op een actie op
   *  het VERKEERDE element als dat toevallig ook een element met die ref had). */
  private locatorFor(ref: string): import("playwright").Locator {
    const m = /^f(\d+):(.+)$/.exec(ref);
    const localRef = m ? m[2]! : ref;
    if (!PlaywrightHand.SAFE_LOCAL_REF.test(localRef)) {
      throw new Error(`Ongeldige ref geweigerd: ${JSON.stringify(ref)}`);
    }
    if (!m) return this.requirePage().locator(`[data-yad-ref="${localRef}"]`).first();
    const frameIdx = Number(m[1]);
    const frame = this.frameCache.get(frameIdx);
    if (!frame) {
      throw new Error(`Frame ${frameIdx} niet meer bekend — de pagina veranderde sinds de laatste snapshot, vraag een nieuwe aan`);
    }
    return frame.locator(`[data-yad-ref="${localRef}"]`).first();
  }

  /** Lost een click-at-viewportpunt (x,y in pixels) frame-bewust op: valt het punt
   *  binnen een bekend sub-frame (mogelijk cross-origin), dan wordt het element DAARIN
   *  opgezocht (met die frame-URL erbij), niet alleen het kale <iframe>-element op het
   *  hoofddocument. Zonder dit was resolveClickAtTarget hieronder blind voor alles
   *  binnen een cross-origin iframe — document.elementFromPoint() op het hoofddocument
   *  kan daar per browser-beveiliging nooit doorheen kijken, en zag dan hooguit het
   *  lege <iframe>-element zelf (2026-09-16-audit: dit liet zowel de write-role/
   *  CONFIRM_WORDS-poort in guardrails.ts als ScopeGuard's frame-scope-check volledig
   *  buitenspel voor click-at, ook al werkte de daadwerkelijke klik — page.mouse.click,
   *  een browser-niveau hit-test — wél gewoon dwars door de iframe-grens heen). */
  private async resolveClickAtFrameAware(
    x: number,
    y: number,
  ): Promise<{ role: string; name: string; frameUrl: string } | null> {
    const page = this.requirePage();
    for (const [idx, frame] of this.frameCache) {
      if (idx === 0) continue; // hoofdframe: fallback hieronder
      const frameEl = await frame.frameElement().catch(() => null);
      if (!frameEl) continue;
      const box = await frameEl.boundingBox().catch(() => null);
      if (!box) continue;
      if (x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height) continue;
      const rel: [number, number] = [x - box.x, y - box.y];
      const inner = await frame.evaluate(resolveClickAtTarget, rel).catch(() => null);
      if (inner) return { ...inner, frameUrl: frame.url() };
    }
    const top = await page.evaluate(resolveClickAtTarget, [x, y] as [number, number]);
    return top ? { ...top, frameUrl: page.url() } : null;
  }

  async act(action: Action): Promise<ActResult> {
    const page = this.requirePage();
    try {
      switch (action.kind) {
        case "navigate": {
          const tStart = Date.now() - this.videoStartTs;
          // Bij eerste navigatie: injecteer eventuele cookies in de browsercontext.
          if (this.firstNav && this.options.cookies?.length) {
            await this.injectCookies(action.url);
            this.firstNav = false;
          }
          await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
          await page.waitForTimeout(this.options.spaWaitMs);
          this.markDemo("navigate", tStart);
          return { ok: true };
        }
        case "click": {
          const tStart = Date.now() - this.videoStartTs;
          const el = this.locatorFor(action.ref);
          await this.glideTo(el);
          await el.click({ timeout: 8_000 });
          await page.waitForTimeout(this.options.spaWaitMs / 2);
          this.markDemo("click", tStart);
          return { ok: true };
        }
        case "click-at": {
          const tStart = Date.now() - this.videoStartTs;
          // Vision-fallback: geen data-yad-ref beschikbaar, klik op de rauwe
          // viewport-positie (fractie van de huidige viewport-afmeting).
          const size = page.viewportSize() ?? { width: 1280, height: 800 };
          const x = Math.max(0, Math.min(1, action.xFraction)) * size.width;
          const y = Math.max(0, Math.min(1, action.yFraction)) * size.height;
          if (action.resolveOnly) {
            // Zelfde contract als de Chrome-extensie (packages/extension/lib/executor.ts,
            // clickAtViewportPoint): alleen vaststellen welk element ECHT op deze positie
            // staat, NIET klikken — zodat de companion-poort (guardrails.ts, via
            // buildGateContext in loop.ts) dezelfde write-role/CONFIRM_WORDS/DENY_WORDS-
            // check kan toepassen als bij een gewone klik, vóór er iets gebeurt. Zonder
            // deze tak zou de resolve-ronde die loop.ts nu voor ELKE click-at aanvraagt
            // hieronder gewoon meteen een ECHTE `page.mouse.click()` uitvoeren — één keer
            // voor de "peiling", nog een keer na goedkeuring: een dubbele klik.
            const resolved = await this.resolveClickAtFrameAware(x, y);
            if (!resolved) return { ok: false, detail: "geen element gevonden op deze positie" };
            return { ok: true, resolvedTarget: resolved };
          }
          if (this.options.demoCursor && this.page) {
            await this.page.mouse.move(x, y, { steps: 18 });
            await this.page.waitForTimeout(450);
          }
          await page.mouse.click(x, y);
          await page.waitForTimeout(this.options.spaWaitMs / 2);
          this.markDemo("click-at", tStart);
          return { ok: true };
        }
        case "type": {
          const tStart = Date.now() - this.videoStartTs;
          const el = this.locatorFor(action.ref);
          await this.glideTo(el);
          if (this.options.demoCursor) {
            // fill('') maakt het veld in één stap leeg (in plaats van klik + Control+a +
            // Delete als losse ronden) — zonder dit plakt een herhaalde typ-actie op
            // hetzelfde veld aan de oude waarde vast, net als bij een kale click() hierboven.
            await el.fill("", { timeout: 8_000 });
            await el.pressSequentially(action.text, { delay: 28 });
          } else {
            await el.fill(action.text, { timeout: 8_000 });
          }
          if (action.submit) await el.press("Enter");
          await page.waitForTimeout(this.options.spaWaitMs / 2);
          this.markDemo("type", tStart);
          return { ok: true };
        }
        case "paste": {
          const tStart = Date.now() - this.videoStartTs;
          const el = this.locatorFor(action.ref);
          await this.glideTo(el);
          await el.click({ timeout: 8_000 });
          await page.keyboard.press("Control+a");
          await page.keyboard.insertText(action.text);
          if (action.submit) await el.press("Enter");
          await page.waitForTimeout(this.options.spaWaitMs / 2);
          this.markDemo("paste", tStart);
          return { ok: true };
        }
        case "hover": {
          const el = this.locatorFor(action.ref);
          await el.hover({ timeout: 8_000 });
          await page.waitForTimeout(120);
          return { ok: true };
        }
        case "keyboard": {
          const target = action.ref
            ? this.locatorFor(action.ref)
            : null;
          if (target) await target.focus({ timeout: 5_000 });
          // Playwright accepteert "Control+a", "Shift+Tab", "Escape" direct als key-combinatie.
          await page.keyboard.press(action.key);
          await page.waitForTimeout(80);
          return { ok: true };
        }
        case "upload": {
          const el = this.locatorFor(action.ref);
          const safeName = action.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
          const tmpPath = join(tmpdir(), `yad-upload-${Date.now()}-${safeName}`);
          await writeFile(tmpPath, action.content, "utf-8");
          try {
            await el.setInputFiles(tmpPath, { timeout: 8_000 });
            return { ok: true };
          } finally {
            await unlink(tmpPath).catch(() => {});
          }
        }
        case "upload-local": {
          // Playwright heeft directe bestandstoegang — gebruik setInputFiles met het lokale pad.
          const el = this.locatorFor(action.ref);
          await el.setInputFiles(action.path, { timeout: 8_000 });
          return { ok: true };
        }
        case "select": {
          const el = this.locatorFor(action.ref);
          await el.selectOption(action.value, { timeout: 8_000 });
          return { ok: true };
        }
        case "extract": {
          const ref = action.ref;
          let extracted: string;
          if (ref) {
            const el = this.locatorFor(ref);
            extracted = ((await el.textContent({ timeout: 5_000 })) ?? "").trim();
            // Lege tekst op een gevonden ref is meestal een dropdown-trigger waarvan de opties
            // elders (portal) renderen, of content die nog niet geladen is — niet een "leeg
            // element". Rapporteer als falen i.p.v. stilzwijgend ok:true (zie extension/lib/
            // executor.ts voor dezelfde fix aan de Chrome-extensie kant).
            if (!extracted) {
              return { ok: false, detail: `ref ${ref} bevat geen tekst — mogelijk nog niet geladen, of de inhoud (bv. dropdown-opties) rendert elders in de DOM` };
            }
            return { ok: true, extracted };
          } else {
            // Prefereer <main> of [role="main"] of <article> boven de volledige body.
            // Grote navigatie-blokken (GitHub, Reddit, etc.) beginnen de body.innerText
            // maar bevatten geen bruikbare content — het main-element heeft die wel.
            extracted = await page.evaluate(`(function() {
              const main = document.querySelector('main, [role="main"], article');
              if (main) {
                const t = (main.innerText || '').trim();
                if (t.length > 300) return t.slice(0, 5000);
              }
              return (document.body?.innerText ?? '').slice(0, 5000);
            })()`
            ) as string;
          }
          return { ok: true, extracted };
        }
        case "scroll": {
          if (action.ref) {
            await this.locatorFor(action.ref).scrollIntoViewIfNeeded();
          } else {
            const px = (action.amount ?? 3) * 120;
            const dy = action.direction === "down" ? px : action.direction === "up" ? -px : 0;
            const dx = action.direction === "right" ? px : action.direction === "left" ? -px : 0;
            await page.evaluate(([x, y]: number[]) => { (globalThis as unknown as { scrollBy: (x: number, y: number) => void }).scrollBy(x ?? 0, y ?? 0); }, [dx, dy]);
          }
          return { ok: true };
        }
        case "wait": {
          await page.waitForTimeout(action.ms);
          return { ok: true };
        }
        case "wait-for": {
          // Hoort hier nooit te komen: de lus vangt wait-for af en lost het op met
          // herhaalde snapshots, want er valt in de pagina niets uit te voeren. Toch
          // een eerlijke fout in plaats van stil `ok: true`, zodat een toekomstige
          // aanroeper die de lus omzeilt het meteen merkt in plaats van te denken dat
          // er gewacht is terwijl dat niet gebeurde.
          return { ok: false, detail: "wait-for hoort door de agent-lus te worden afgehandeld, niet door de Hand" };
        }
        // De volgende vier worden hier ECHT uitgevoerd en niet nagebootst met losse
        // gebeurtenissen: Playwright stuurt ze op driver-niveau, wat betrouwbaarder is
        // dan wat een content-script in de pagina kan doen.
        case "drag": {
          const van = this.locatorFor(action.ref);
          const naar = this.locatorFor(action.toRef);
          await van.dragTo(naar);
          return { ok: true };
        }
        case "right-click": {
          await this.locatorFor(action.ref).click({ button: "right" });
          return { ok: true };
        }
        case "history": {
          if (action.direction === "back") await page.goBack();
          else await page.goForward();
          return { ok: true };
        }
        case "copy": {
          const el = this.locatorFor(action.ref);
          const waarde = (await el.inputValue().catch(() => null)) ?? (await el.textContent()) ?? "";
          if (!waarde) return { ok: false, detail: "element heeft geen tekst of waarde om te kopiëren" };
          // Het klembord is in een headless context vaak niet beschikbaar. De tekst gaat
          // hoe dan ook mee terug, zodat een paste-actie erna kan werken.
          return { ok: true, extracted: waarde.slice(0, 2000) };
        }
        case "finish": {
          return { ok: true };
        }
      }
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async requestScreenshot(): Promise<string | null> {
    try {
      const page = this.requirePage();
      const buf = await page.screenshot({ type: "jpeg", quality: 60 });
      return `data:image/jpeg;base64,${buf.toString("base64")}`;
    } catch {
      return null;
    }
  }

  async requestConfirm(action: Action, reason: string): Promise<boolean> {
    this.options.log(`CONFIRM GEVRAAGD: ${reason} | actie: ${JSON.stringify(action)}`);
    return this.options.onConfirm(action, reason);
  }

  update(u: { status: RunStatus; step?: number; message: string; action?: Action }): void {
    const stepStr = u.step != null ? ` [stap ${u.step}]` : "";
    this.options.log(`[${u.status}]${stepStr} ${u.message}`);
  }

  /** Uitsluitend voor robuustheidstests: forceert een navigatie op de lopende pagina, buiten
   * de agent-lus om, om een "onverwachte paginawisseling" te simuleren (zie
   * scripts/robustness-nav-hijack.ts). Niet bedoeld voor productiegebruik. */
  async forceNavigateForTest(url: string): Promise<void> {
    await this.requirePage().goto(url, { waitUntil: "domcontentloaded" });
  }

  private requirePage(): Page {
    if (!this.page) throw new Error("PlaywrightHand niet geïnitialiseerd — roep init() aan.");
    return this.page;
  }

  private async injectCookies(navigationUrl: string): Promise<void> {
    if (!this.options.cookies?.length || !this.page) return;
    let domain: string;
    try {
      domain = new URL(navigationUrl).hostname;
    } catch {
      return;
    }
    const ctx = this.page.context();
    for (const c of this.options.cookies) {
      try {
        await ctx.addCookies([{
          name: c.name,
          value: c.value,
          domain: c.domain || domain,
          path: c.path ?? "/",
        }]);
      } catch {
        /* ongeldige cookie → overslaan */
      }
    }
    this.options.log(`${this.options.cookies.length} cookies geïnjecteerd voor ${domain}`);
  }
}
