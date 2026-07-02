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

export class PlaywrightHand implements HandBridge {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly options: Required<Omit<PlaywrightHandOptions, "cookies">> & { cookies?: PlaywrightHandOptions["cookies"] };
  private firstNav = true;

  constructor(opts: PlaywrightHandOptions = {}) {
    this.options = {
      headless: opts.headless ?? true,
      spaWaitMs: opts.spaWaitMs ?? 800,
      onConfirm: opts.onConfirm ?? (async () => true), // auto-goedkeuren (ScopeGuard blokkeert toch)
      log: opts.log ?? ((m) => console.log(`[playwright-hand] ${m}`)),
      cookies: opts.cookies,
    };
  }

  async init(): Promise<void> {
    this.browser = await chromium.launch({ headless: this.options.headless });
    const ctx = await this.browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    this.page = await ctx.newPage();
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
      const raw = await page.evaluate("document.body?.innerText ?? ''") as string;
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
          // Bij eerste navigatie: injecteer eventuele cookies in de browsercontext.
          if (this.firstNav && this.options.cookies?.length) {
            await this.injectCookies(action.url);
            this.firstNav = false;
          }
          await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
          await page.waitForTimeout(this.options.spaWaitMs);
          return { ok: true };
        }
        case "click": {
          const el = page.locator(`[data-yad-ref="${action.ref}"]`).first();
          await el.click({ timeout: 8_000 });
          await page.waitForTimeout(this.options.spaWaitMs / 2);
          return { ok: true };
        }
        case "type": {
          const el = page.locator(`[data-yad-ref="${action.ref}"]`).first();
          await el.fill(action.text, { timeout: 8_000 });
          if (action.submit) await el.press("Enter");
          await page.waitForTimeout(this.options.spaWaitMs / 2);
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
            extracted = (await el.textContent({ timeout: 5_000 })) ?? "";
          } else {
            extracted = await page.evaluate(
              "(document.body?.innerText ?? '').slice(0, 4000)",
            ) as string;
          }
          return { ok: true, extracted };
        }
        case "wait": {
          await page.waitForTimeout(action.ms);
          return { ok: true };
        }
        case "finish": {
          return { ok: true };
        }
      }
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
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
