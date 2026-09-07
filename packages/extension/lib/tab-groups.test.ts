import { describe, it, expect, vi } from "vitest";
import { YadTabGroupManager, YAD_GROUP_TITLE, YAD_GROUP_COLOR, type TabGroupsChromeApi } from "./tab-groups";

/** Kleine, programmeerbare nep-chrome voor deze suite. */
function maakNepApi(overrides: Partial<TabGroupsChromeApi> = {}): TabGroupsChromeApi {
  return {
    tabGroups: {
      query: vi.fn(async () => []),
      update: vi.fn(async () => undefined),
      ...(overrides.tabGroups ?? {}),
    },
    tabs: {
      group: vi.fn(async ({ groupId }: { tabIds: number | number[]; groupId?: number }) => groupId ?? 777),
      ungroup: vi.fn(async () => undefined),
      ...(overrides.tabs ?? {}),
    },
  };
}

describe("YadTabGroupManager — de gebruiker moet kunnen zien welke tabs van YAD zijn", () => {
  it("maakt een nieuwe, benoemde en gekleurde groep als er nog geen bestaat", async () => {
    const api = maakNepApi();
    const manager = new YadTabGroupManager(api);

    const groupId = await manager.ensureYadGroup(10);

    expect(groupId).toBe(777);
    expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: 10 });
    expect(api.tabGroups.update).toHaveBeenCalledWith(777, { title: YAD_GROUP_TITLE, color: YAD_GROUP_COLOR });
  });

  it("hergebruikt de onthouden groep voor een volgende tab, zonder opnieuw te benoemen", async () => {
    const api = maakNepApi();
    const manager = new YadTabGroupManager(api);
    await manager.ensureYadGroup(10);
    vi.mocked(api.tabGroups.update).mockClear();

    await manager.ensureYadGroup(11);

    expect(api.tabs.group).toHaveBeenLastCalledWith({ tabIds: 11, groupId: 777 });
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });

  it("hergroepeert een tab ALTIJD expliciet, ook als hij al ergens bij hoort", async () => {
    // Dit is de "nieuwe tab erft de buurman-groep"-valkuil (playwright#42259): een
    // tab kan al in een andere groep zitten zodra hij aangemaakt wordt. De manager
    // roept group() gewoon aan zonder eerst te checken of de tab al gegroepeerd is,
    // en tabs.group() in Chrome verplaatst een tab uit zijn huidige groep vanzelf.
    const api = maakNepApi();
    const manager = new YadTabGroupManager(api);

    await manager.ensureYadGroup(10);

    // De kern van de test: group() is aangeroepen, niet overgeslagen omdat de tab
    // toevallig al ergens bij zou kunnen horen.
    expect(api.tabs.group).toHaveBeenCalledTimes(1);
  });

  it("vindt de bestaande YAD-groep terug na een herstart (leeg geheugen, Chrome-groep bestaat nog)", async () => {
    // Simuleert een verse MV3 service-worker instantie: cachedGroupId is null, maar
    // de tabgroep zelf bestaat nog gewoon in Chrome.
    const api = maakNepApi({
      tabGroups: {
        query: vi.fn(async ({ title }) => (title === YAD_GROUP_TITLE ? [{ id: 42, title: YAD_GROUP_TITLE }] : [])),
        update: vi.fn(async () => undefined),
      },
    });
    const manager = new YadTabGroupManager(api);

    const groupId = await manager.ensureYadGroup(10);

    expect(groupId).toBe(42);
    expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: 10, groupId: 42 });
    // Geen nieuwe titel/kleur gezet: de groep had die al.
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });

  it("maakt geen tweede, verweesde groep als de onthouden groep is verdwenen", async () => {
    let eersteAanroep = true;
    const api = maakNepApi({
      tabs: {
        group: vi.fn(async ({ groupId }: { tabIds: number | number[]; groupId?: number }) => {
          if (groupId === 777 && !eersteAanroep) {
            throw new Error("No group with id: 777");
          }
          eersteAanroep = false;
          return groupId ?? 777;
        }),
        ungroup: vi.fn(async () => undefined),
      },
      tabGroups: {
        // Na het verdwijnen van 777 vindt de titel-zoekopdracht een NIEUWE groep 900,
        // alsof de gebruiker de oude groep sloot en de agent later opnieuw begon.
        query: vi.fn(async () => [{ id: 900, title: YAD_GROUP_TITLE }]),
        update: vi.fn(async () => undefined),
      },
    });
    const manager = new YadTabGroupManager(api);

    await manager.ensureYadGroup(10); // vult cache met 777
    const tweedeGroupId = await manager.ensureYadGroup(11); // 777 is nu "weg"

    expect(tweedeGroupId).toBe(900);
    // group() nooit aangeroepen ZONDER groupId op de tweede poging: dat zou een
    // gloednieuwe, ongewenste tweede groep aanmaken in plaats van de gevonden 900 te
    // hergebruiken.
    expect(api.tabs.group).not.toHaveBeenCalledWith({ tabIds: 11 });
  });

  it("herprobeert bij 'user may be dragging a tab' en geeft niet meteen op", async () => {
    let pogingen = 0;
    const api = maakNepApi({
      tabs: {
        group: vi.fn(async () => {
          pogingen++;
          if (pogingen < 3) throw new Error("Tabs cannot be edited right now (user may be dragging a tab).");
          return 777;
        }),
        ungroup: vi.fn(async () => undefined),
      },
    });
    const manager = new YadTabGroupManager(api);

    const groupId = await manager.ensureYadGroup(10);

    expect(groupId).toBe(777);
    expect(pogingen).toBe(3);
  });

  it("geeft een andere fout meteen door, zonder vijf keer te herproberen", async () => {
    let pogingen = 0;
    const api = maakNepApi({
      tabs: {
        group: vi.fn(async () => {
          pogingen++;
          throw new Error("No tab with id: 10.");
        }),
        ungroup: vi.fn(async () => undefined),
      },
    });
    const manager = new YadTabGroupManager(api);

    await expect(manager.ensureYadGroup(10)).rejects.toThrow("No tab with id: 10.");
    expect(pogingen).toBe(1);
  });

  it("release haalt een tab uit de groep zonder hem te sluiten", async () => {
    const api = maakNepApi();
    const manager = new YadTabGroupManager(api);

    await manager.release(10);

    expect(api.tabs.ungroup).toHaveBeenCalledWith(10);
  });

  it("release faalt niet hard als de tab al weg of ongegroepeerd is", async () => {
    const api = maakNepApi({
      tabs: {
        group: vi.fn(async () => 777),
        ungroup: vi.fn(async () => { throw new Error("No tab with id: 10."); }),
      },
    });
    const manager = new YadTabGroupManager(api);

    await expect(manager.release(10)).resolves.toBeUndefined();
  });
});
