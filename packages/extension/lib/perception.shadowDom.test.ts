import { describe, it, expect, afterEach } from "vitest";
import { collectDeepText, buildSnapshot } from "./perception";
import { executeAction } from "./executor";

afterEach(() => {
  document.body.innerHTML = "";
});

// Bootst na wat er op Adobe Firefly/Express gebeurde (2026-09-12): de hele UI zit in
// een open shadow root achter een custom element, met alleen een verborgen SEO-tekstje
// in het lichte DOM. document.body.innerText/textContent stopt bij die shadow-boundary
// en zag daardoor NIETS van de echte pagina, ook al was de agent allang ingelogd en
// volledig geladen. Zonder deze test kan die regressie stilletjes terugkomen.
function maakPaginaMetShadowDom(): void {
  const host = document.createElement("div");
  host.setAttribute("data-testid", "app-shell");
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = "<button>Nieuw ontwerp</button><p>Welkom bij de editor</p>";
}

describe("collectDeepText — doorkruist open shadow DOM", () => {
  it("mist shadow-inhoud volledig via kale document.body.textContent (bewijs van het gat)", () => {
    maakPaginaMetShadowDom();
    expect(document.body.textContent ?? "").not.toContain("Welkom bij de editor");
  });

  it("vindt tekst die uitsluitend in een open shadow root staat", () => {
    maakPaginaMetShadowDom();
    const tekst = collectDeepText(document);
    expect(tekst).toContain("Welkom bij de editor");
    expect(tekst).toContain("Nieuw ontwerp");
  });

  it("werkt onveranderd op een gewone pagina zonder shadow DOM (geen regressie)", () => {
    document.body.innerHTML = "<main><h1>Gewone pagina</h1></main>";
    expect(collectDeepText(document)).toContain("Gewone pagina");
  });

  it("doorkruist geneste shadow roots (component binnen component)", () => {
    const buiten = document.createElement("div");
    document.body.appendChild(buiten);
    const buitenRoot = buiten.attachShadow({ mode: "open" });
    const binnen = document.createElement("div");
    buitenRoot.appendChild(binnen);
    const binnenRoot = binnen.attachShadow({ mode: "open" });
    binnenRoot.innerHTML = "<span>diep genest</span>";

    expect(collectDeepText(document)).toContain("diep genest");
  });
});

describe("buildSnapshot — textDigest doorkruist open shadow DOM", () => {
  it("neemt shadow-DOM-tekst mee in de textDigest die het Brein leest", () => {
    maakPaginaMetShadowDom();
    const snapshot = buildSnapshot(new Map());
    expect(snapshot.textDigest).toContain("Welkom bij de editor");
  });
});

describe("executeAction extract (hele pagina) — vindt tekst achter shadow DOM", () => {
  it("meldt niet langer 'geen zichtbare tekst' op een web-component-app zoals Firefly/Express", async () => {
    maakPaginaMetShadowDom();

    const result = await executeAction({ kind: "extract", what: "paginatekst" }, new Map());

    expect(result.ok).toBe(true);
    expect(result.extracted).toContain("Welkom bij de editor");
  });
});
