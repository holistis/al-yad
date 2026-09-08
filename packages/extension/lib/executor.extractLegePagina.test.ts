import { describe, it, expect, afterEach } from "vitest";
import { executeAction } from "./executor";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("executeAction extract (hele pagina) — leeg mag niet stil ok:true worden", () => {
  it("meldt een duidelijke fout wanneer de hele pagina geen zichtbare tekst heeft", async () => {
    // Bootst precies na wat er gebeurde toen de koning "vat deze pagina samen" vroeg op
    // een echte ServiceNow-marketingpagina: het Brein kreeg een lege extractie terug,
    // meldde stil ok:true, en het taalmodel zei eerlijk (maar misleidend) "geen inhoud".
    // De hele-pagina-tak had géén leeg-check, terwijl de ref-tak (regel hierboven) die
    // wel al had — precies dezelfde inconsistentie die deze test moet dichten.
    document.body.innerHTML = "";

    const result = await executeAction({ kind: "extract", what: "paginatekst" }, new Map());

    expect(result.ok).toBe(false);
    expect(result.detail).toBeTruthy();
  });

  it("blijft gewoon werken op een pagina met echte tekst (geen regressie)", async () => {
    document.body.innerHTML = "<main><h1>Agentic AI voor bedrijfstransformatie</h1><p>Ontdek hoe ServiceNow AI-agents inzet.</p></main>";

    const result = await executeAction({ kind: "extract", what: "paginatekst" }, new Map());

    expect(result.ok).toBe(true);
    expect(result.extracted).toContain("Agentic AI voor bedrijfstransformatie");
  });
});
