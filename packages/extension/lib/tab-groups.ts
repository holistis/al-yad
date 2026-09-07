/**
 * Zichtbaarheid voor de mens: welke tabs zijn van YAD.
 *
 * Vóór dit bestand had YAD geen enkel besef van chrome.tabGroups (geverifieerd:
 * grep op "tabGroups" over de hele extensie gaf nul treffers). Dat is precies het
 * grootste, opgemerkte gemis tegenover Microsoft's Playwright MCP extension-mode
 * (connectedTabGroup.ts): een gekleurde, benoemde tabgroep zodat de gebruiker in
 * één oogopslag ziet welke tabs de agent gebruikt, en er zelf een uit kan slepen
 * om hem terug te pakken.
 *
 * YAD is single-agent (één taak tegelijk, session.ts weigert een tweede), dus dit
 * hoeft niet Playwright's Map<connectionId, group> te zijn: één groep, altijd
 * getiteld "YAD", is genoeg.
 *
 * Twee valkuilen die Microsoft al betaald heeft (asm-spec/playwright#42259), hier
 * bewust overgenomen:
 * - Een nieuwe tab erft de tabgroep van de actieve tab. Daarom hergroepeert
 *   ensureYadGroup ALTIJD expliciet, ook als de tab al ergens bij hoort.
 * - Chrome gooit "user may be dragging a tab" tijdens groepsmutaties. retryOnDrag
 *   herprobeert met dezelfde backoff-reeks die Playwright gebruikt.
 */

/**
 * Chrome staat maar acht kleuren toe voor een tabgroep. Een losse union in plaats
 * van chrome.tabGroups.ColorEnum zelf, zodat dit bestand (en zijn tests) los van
 * @types/chrome blijven, precies zoals executor.ts los blijft van de DOM-lib-versie.
 */
export type YadGroupColor = "cyan" | "blue" | "green" | "grey" | "orange" | "pink" | "purple" | "red" | "yellow";

export interface TabGroupsChromeApi {
  tabGroups: {
    query(info: { title?: string }): Promise<Array<{ id: number; title?: string }>>;
    update(groupId: number, props: { title?: string; color?: YadGroupColor }): Promise<unknown>;
  };
  tabs: {
    /** Eén tab per aanroep: dit bestand groepeert altijd exact één tabId tegelijk. */
    group(options: { tabIds: number; groupId?: number }): Promise<number>;
    ungroup(tabIds: number): Promise<void>;
  };
}

export const YAD_GROUP_TITLE = "YAD";
export const YAD_GROUP_COLOR: YadGroupColor = "cyan";

/** Backoff-reeks bij "user may be dragging a tab": zelfde vijf stappen als Playwright. */
const DRAG_RETRY_DELAYS_MS = [0, 100, 200, 400, 800];

async function wacht(ms: number): Promise<void> {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

async function retryOnDrag<T>(fn: () => Promise<T>): Promise<T> {
  let laatsteFout: unknown;
  for (const delay of DRAG_RETRY_DELAYS_MS) {
    await wacht(delay);
    try {
      return await fn();
    } catch (e) {
      laatsteFout = e;
      // Alleen herproberen op de sleep-fout zelf; elke andere fout (tab bestaat niet
      // meer, geen permissie) moet meteen omhoog, niet vijf keer herhaald worden.
      if (!/dragging/i.test(String(e))) throw e;
    }
  }
  throw laatsteFout;
}

/**
 * Eén sessie-instantie per service-worker-leven. cachedGroupId is bewust een
 * instantieveld, niet module-state: dat maakt de klasse in isolatie testbaar
 * (elke test krijgt zijn eigen manager) zonder dat tests elkaars cache zien.
 */
export class YadTabGroupManager {
  private cachedGroupId: number | null = null;

  constructor(private readonly api: TabGroupsChromeApi) {}

  /**
   * Voegt de tab toe aan de YAD-groep (maakt hem aan als hij nog niet bestaat), en
   * geeft het groep-id terug. Hergroepeert altijd, ook als de tab al een groep had:
   * dat is wat de "nieuwe tab erft de buurman-groep"-valkuil afvangt.
   */
  async ensureYadGroup(tabId: number): Promise<number> {
    if (this.cachedGroupId != null) {
      try {
        return await retryOnDrag(() => this.api.tabs.group({ tabIds: tabId, groupId: this.cachedGroupId! }));
      } catch {
        // De onthouden groep bestaat niet meer (gebruiker sloot de laatste tab erin,
        // of een MV3-herstart verloor het geheugen terwijl Chrome de groep zelf nog
        // wel heeft). Val door naar de titel-zoekopdracht hieronder in plaats van
        // een tweede, verweesde "YAD"-groep aan te maken.
        this.cachedGroupId = null;
      }
    }

    // Overleeft een herstart van de service worker: het geheugen is weg, maar een
    // reeds bestaande Chrome-tabgroep met deze titel niet. Zelfde patroon als
    // Playwright's titel-prefix-herkenning (connectedTabGroup.ts).
    const bestaande = await this.api.tabGroups.query({ title: YAD_GROUP_TITLE });
    if (bestaande.length > 0) {
      this.cachedGroupId = bestaande[0]!.id;
      return retryOnDrag(() => this.api.tabs.group({ tabIds: tabId, groupId: this.cachedGroupId! }));
    }

    const nieuwId = await retryOnDrag(() => this.api.tabs.group({ tabIds: tabId }));
    await this.api.tabGroups.update(nieuwId, { title: YAD_GROUP_TITLE, color: YAD_GROUP_COLOR });
    this.cachedGroupId = nieuwId;
    return nieuwId;
  }

  /**
   * Haalt de tab uit de YAD-groep zonder hem te sluiten. Dit is hoe de gebruiker
   * een tab "terugpakt": uit de groep slepen in de UI doet chrome.tabs.ungroup
   * vanzelf, dit is de programmatische kant voor als YAD zelf klaar is met een tab.
   */
  async release(tabId: number): Promise<void> {
    try {
      await this.api.tabs.ungroup(tabId);
    } catch {
      // Tab al gesloten of al ongegroepeerd: niets te doen.
    }
  }
}
