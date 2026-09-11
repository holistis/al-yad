import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * resolveRunTab() leest globalThis.chrome direct (geen dependency-injection zoals
 * tab-groups.ts), dus elke test stubt chrome zelf en herimporteert de module vers
 * (vi.resetModules) zodat de module-level stickyTabId-state niet tussen tests lekt.
 */
async function laadVersModule(chromeStub: unknown) {
  vi.resetModules();
  (globalThis as { chrome?: unknown }).chrome = chromeStub;
  return import("./native-port");
}

describe("resolveRunTab — nooit de tab van de user kapen, wel z'n URL als leesstartpunt gebruiken", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("gebruikt de sticky tab als die nog bestaat, zonder een nieuwe tab aan te maken", async () => {
    const tabsCreate = vi.fn();
    const chromeStub = {
      tabs: {
        get: vi.fn(async (id: number) => ({ id, url: "https://voorbeeld.nl/pagina" })),
        create: tabsCreate,
        query: vi.fn(async () => []),
      },
    };
    const mod = await laadVersModule(chromeStub);
    mod.setYadTabId(42);

    const result = await mod.resolveRunTab();

    expect(result).toBe(42);
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it("start een eigen achtergrondtab op de URL van de zichtbare tab, zonder die tab zelf aan te raken", async () => {
    const tabsCreate = vi.fn(async ({ url }: { url: string; active: boolean }) => ({ id: 99, url }));
    const tabsUpdate = vi.fn();
    const chromeStub = {
      tabs: {
        get: vi.fn(async () => { throw new Error("geen sticky tab"); }),
        create: tabsCreate,
        query: vi.fn(async (q: { active?: boolean }) =>
          q.active ? [{ id: 7, url: "https://yadagent.com/", active: true }] : []
        ),
        update: tabsUpdate,
      },
    };
    const mod = await laadVersModule(chromeStub);

    const result = await mod.resolveRunTab();

    expect(result).toBe(99);
    expect(tabsCreate).toHaveBeenCalledWith({ url: "https://yadagent.com/", active: false });
    // De echte, zichtbare tab (id 7) wordt nooit genavigeerd/geklikt/getypt.
    expect(tabsUpdate).not.toHaveBeenCalled();
  });

  it("valt terug op about:blank als de zichtbare tab geen http(s)-URL heeft (bv. chrome://extensions)", async () => {
    const tabsCreate = vi.fn(async ({ url }: { url: string; active: boolean }) => ({ id: 5, url }));
    const chromeStub = {
      tabs: {
        get: vi.fn(async () => { throw new Error("geen sticky tab"); }),
        create: tabsCreate,
        query: vi.fn(async (q: { active?: boolean }) =>
          q.active ? [{ id: 3, url: "chrome://extensions/", active: true }] : []
        ),
      },
    };
    const mod = await laadVersModule(chromeStub);

    const result = await mod.resolveRunTab();

    expect(result).toBe(5);
    expect(tabsCreate).toHaveBeenCalledWith({ url: "about:blank", active: false });
  });

  it("valt terug op about:blank als het opvragen van de zichtbare tab faalt", async () => {
    const tabsCreate = vi.fn(async ({ url }: { url: string; active: boolean }) => ({ id: 6, url }));
    const chromeStub = {
      tabs: {
        get: vi.fn(async () => { throw new Error("geen sticky tab"); }),
        create: tabsCreate,
        query: vi.fn(async () => { throw new Error("query mislukt"); }),
      },
    };
    const mod = await laadVersModule(chromeStub);

    const result = await mod.resolveRunTab();

    expect(result).toBe(6);
    expect(tabsCreate).toHaveBeenCalledWith({ url: "about:blank", active: false });
  });
});
