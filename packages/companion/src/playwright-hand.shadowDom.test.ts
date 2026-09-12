// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { SNAPSHOT_SCRIPT, TEXT_DIGEST_SCRIPT } from "./playwright-hand";

// Deze twee scripts draaien normaal via Playwright's page.evaluate() in een echte
// browserpagina; hier evalueren we ze rechtstreeks in jsdom zodat de shadow-DOM-
// doorkruising getest wordt zonder een echte Chromium-instantie te starten (dezelfde
// onderliggende logica als packages/extension/lib/perception.shadowDom.test.ts).
// jsdom mist innerText (geen layout-engine), dus we polyfillen 'm hier lokaal net als
// packages/extension/lib/test-setup.ts al doet.
if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText")) {
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement): string {
      return this.textContent ?? "";
    },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

function maakPaginaMetShadowDom(): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = "<button>Nieuw ontwerp</button><p>Welkom bij de editor</p>";
}

describe("PlaywrightHand SNAPSHOT_SCRIPT — doorkruist open shadow DOM", () => {
  it("vindt interactieve elementen die uitsluitend in een open shadow root staan", () => {
    maakPaginaMetShadowDom();
    // eslint-disable-next-line no-eval -- test evalueert exact het script dat page.evaluate() ook draait
    const nodes = eval(SNAPSHOT_SCRIPT) as Array<{ role: string; name: string }>;
    const namen = nodes.map((n) => n.name);
    expect(namen).toContain("Nieuw ontwerp");
  });
});

describe("PlaywrightHand TEXT_DIGEST_SCRIPT — doorkruist open shadow DOM", () => {
  it("vindt tekst die uitsluitend in een open shadow root staat", () => {
    maakPaginaMetShadowDom();
    // eslint-disable-next-line no-eval -- test evalueert exact het script dat page.evaluate() ook draait
    const tekst = eval(TEXT_DIGEST_SCRIPT) as string;
    expect(tekst).toContain("Welkom bij de editor");
  });

  it("werkt onveranderd op een gewone pagina zonder shadow DOM (geen regressie)", () => {
    document.body.innerHTML = "<p>Gewone pagina zonder web components</p>";
    // eslint-disable-next-line no-eval
    const tekst = eval(TEXT_DIGEST_SCRIPT) as string;
    expect(tekst).toContain("Gewone pagina zonder web components");
  });
});
