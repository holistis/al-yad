// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { resolveClickAtTarget } from "./playwright-hand";

/**
 * Restpunt uit de adversariële review 2026-09-13, ontdekt tijdens het dichten van het
 * ORIGINELE gat in packages/extension/lib/executor.ts (Chrome-extensie): PlaywrightHand
 * (deze module) is een TWEEDE, zelfstandige HandBridge-implementatie (geen Chrome-
 * extensie nodig — o.a. gebruikt door packages/companion/src/main-server.ts's publieke
 * HTTP-endpoint, in autonomy="auto" met een auto-approve onConfirm-stub). Voor die Hand
 * had click-at GEEN resolveOnly-tak: loop.ts's nieuwe resolve-ronde (buildGateContext)
 * zou hier zonder deze fix gewoon meteen een ECHTE `page.mouse.click()` hebben
 * uitgevoerd voor de "peiling", gevolgd door een TWEEDE echte klik na de (auto-
 * goedgekeurde) bevestiging — een dubbele klik op elke click-at via deze Hand.
 *
 * resolveClickAtTarget() is de in-page functie die dat oplost: hetzelfde contract als
 * clickAtViewportPoint(..., resolveOnly:true) in de extensie (rol + naam teruggeven,
 * niet klikken). Deze tests draaien 'm rechtstreeks in jsdom, zelfde patroon als
 * SNAPSHOT_SCRIPT/TEXT_DIGEST_SCRIPT in playwright-hand.shadowDom.test.ts.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PlaywrightHand resolveClickAtTarget — click-at resolveOnly (geen klik)", () => {
  it("identificeert een muterend doelwit (button) met rol en naam", () => {
    document.body.innerHTML = `<button id="danger">Verwijder account</button>`;
    const btn = document.getElementById("danger") as HTMLButtonElement;
    document.elementFromPoint = () => btn;

    const result = resolveClickAtTarget([10, 10]);
    expect(result).toEqual({ role: "button", name: "Verwijder account" });
  });

  it("identificeert een onschuldig doelwit (link) met rol en naam", () => {
    document.body.innerHTML = `<a href="/meer" id="link">Lees meer</a>`;
    const link = document.getElementById("link") as HTMLAnchorElement;
    document.elementFromPoint = () => link;

    const result = resolveClickAtTarget([10, 10]);
    expect(result).toEqual({ role: "link", name: "Lees meer" });
  });

  it("geeft null terug als er niets op die positie staat, in plaats van een doelwit te verzinnen", () => {
    document.elementFromPoint = () => null;
    const result = resolveClickAtTarget([10, 10]);
    expect(result).toBeNull();
  });

  it("klikt NOOIT — puur een DOM-inspectie zonder events te versturen", () => {
    document.body.innerHTML = `<button id="danger">Verwijder account</button>`;
    const btn = document.getElementById("danger") as HTMLButtonElement;
    let clicked = false;
    btn.addEventListener("click", () => (clicked = true));
    document.elementFromPoint = () => btn;

    resolveClickAtTarget([10, 10]);
    expect(clicked).toBe(false);
  });
});
