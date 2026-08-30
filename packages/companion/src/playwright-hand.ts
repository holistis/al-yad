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
import { chromium, type Browser, type Page } from "playwright";
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
}

/** JavaScript dat in de pagina-context draait om de snapshot te bouwen. */
const SNAPSHOT_SCRIPT = `(() => {
  const SELECTOR = [
    'a[href]', 'button', 'input:not([type="hidden"])',
    'select', 'textarea', '[role="button"]', '[role="link"]',
    '[role="checkbox"]', '[role="menuitem"]', '[role="tab"]',
    '[role="combobox"]', '[role="textbox"]',
  ].join(',');
  const els = Array.from(document.querySelectorAll(SELECTOR)).slice(0, ${SNAPSHOT_LIMITS.MAX_NODES});
  let idx = 1;
  const nodes = [];
  for (const el of els) {
    const ref = 'e' + idx++;
    el.setAttribute('data-yad-ref', ref);
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
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
  private readonly options: Required<Omit<PlaywrightHandOptions, "cookies">> & { cookies?: PlaywrightHandOptions["cookies"] };
  private firstNav = true;

  constructor(opts: PlaywrightHandOptions = {}) {
    this.options = {
      headless: opts.headless ?? true,
      spaWaitMs: opts.spaWaitMs ?? 800,
      onConfirm: opts.onConfirm ?? (async () => true), // auto-goedkeuren (ScopeGuard blokkeert toch)
      log: opts.log ?? ((m) => console.log(`[playwright-hand] ${m}`)),
      cookies: opts.cookies,
      recordVideoDir: opts.recordVideoDir ?? "",
      demoCursor: opts.demoCursor ?? false,
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
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }

  async requestSnapshot(): Promise<Snapshot> {
    const page = this.requirePage();
    const url = page.url();
    const title = await page.title().catch(() => "");

    let nodes: SnapshotNode[] = [];
    try {
      const raw = (await page.evaluate(SNAPSHOT_SCRIPT)) as SnapshotNode[];
      nodes = raw.map((n) => ({
        ...n,
        name: normalizeText(n.name).slice(0, SNAPSHOT_LIMITS.NAME_LIMIT),
        ...(n.value !== undefined ? { value: normalizeText(n.value).slice(0, SNAPSHOT_LIMITS.NAME_LIMIT) } : {}),
      }));
    } catch {
      /* pagina blokkeert evaluate (bv. about:blank) — lege nodes */
    }

    let textDigest = "";
    try {
      // Prefereer main-content boven volledige body — navigatie-blokken eten anders
      // de textDigest-limiet op voor de echte pagina-inhoud komt.
      const raw = await page.evaluate(`(function() {
        const main = document.querySelector('main, [role="main"], article');
        if (main) {
          const t = (main.innerText || '').trim();
          if (t.length > 300) return t;
        }
        return document.body?.innerText ?? '';
      })()`) as string;
      textDigest = normalizeText(raw).slice(0, SNAPSHOT_LIMITS.DIGEST_LIMIT);
    } catch {
      /* negeer */
    }

    return { url, title: normalizeText(title), nodes, textDigest };
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
          const el = page.locator(`[data-yad-ref="${action.ref}"]`).first();
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
          const el = page.locator(`[data-yad-ref="${action.ref}"]`).first();
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
          const el = page.locator(`[data-yad-ref="${action.ref}"]`).first();
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
          const el = page.locator(`[data-yad-ref="${action.ref}"]`).first();
          await el.hover({ timeout: 8_000 });
          await page.waitForTimeout(120);
          return { ok: true };
        }
        case "keyboard": {
          const target = action.ref
            ? page.locator(`[data-yad-ref="${action.ref}"]`).first()
            : null;
          if (target) await target.focus({ timeout: 5_000 });
          // Playwright accepteert "Control+a", "Shift+Tab", "Escape" direct als key-combinatie.
          await page.keyboard.press(action.key);
          await page.waitForTimeout(80);
          return { ok: true };
        }
        case "upload": {
          const el = page.locator(`[data-yad-ref="${action.ref}"]`).first();
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
          const el = page.locator(`[data-yad-ref="${action.ref}"]`).first();
          await el.setInputFiles(action.path, { timeout: 8_000 });
          return { ok: true };
        }
        case "select": {
          const el = page.locator(`[data-yad-ref="${action.ref}"]`).first();
          await el.selectOption(action.value, { timeout: 8_000 });
          return { ok: true };
        }
        case "extract": {
          const ref = action.ref;
          let extracted: string;
          if (ref) {
            const el = page.locator(`[data-yad-ref="${ref}"]`).first();
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
            await page.locator(`[data-yad-ref="${action.ref}"]`).scrollIntoViewIfNeeded();
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
          const van = page.locator(`[data-yad-ref="${action.ref}"]`).first();
          const naar = page.locator(`[data-yad-ref="${action.toRef}"]`).first();
          await van.dragTo(naar);
          return { ok: true };
        }
        case "right-click": {
          await page.locator(`[data-yad-ref="${action.ref}"]`).first().click({ button: "right" });
          return { ok: true };
        }
        case "history": {
          if (action.direction === "back") await page.goBack();
          else await page.goForward();
          return { ok: true };
        }
        case "copy": {
          const el = page.locator(`[data-yad-ref="${action.ref}"]`).first();
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
