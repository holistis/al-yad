/**
 * Compacte perceptie van een pagina (de Ogen): een platte lijst van interactieve
 * elementen met een stabiel `ref`, plus een korte tekst-samenvatting. Dit is
 * bewust klein gehouden (snapshot + refs) i.p.v. de hele DOM, zodat de LLM weinig
 * tokens nodig heeft en op refs kan kiezen i.p.v. op broze CSS-selectors.
 */
export interface SnapshotNode {
  /** stabiel id binnen deze snapshot, bv. "e12" */
  ref: string;
  /** rol: link, button, textbox, combobox, checkbox, heading, ... */
  role: string;
  /** zichtbare naam/label (afgekapt) */
  name: string;
  /** huidige waarde voor invoervelden */
  value?: string;
  disabled?: boolean;
  /**
   * URL van het frame waar dit element ECHT in staat, indien de Hand dat weet
   * (bv. PlaywrightHand's frame-bewuste snapshot). Ontbreekt dit veld, dan gaat
   * ScopeGuard ervan uit dat het element bij de hoofdpagina hoort — het huidige,
   * niet-frame-bewuste gedrag, geen regressie. IS het gezet en wijkt het domein af
   * van de toewijzing, dan blokkeert ScopeGuard een actie op deze ref alsnog, ook al
   * is het geen `navigate`. Zonder dit veld kon een cross-origin iframe (advertentie,
   * gecompromitteerde widget, phishing-overlay) volledig buiten de domein-scope om
   * bediend worden zodra de Hand zulke elementen uberhaupt kon vinden (2026-09-15-audit).
   */
  frameUrl?: string;
}

export interface Snapshot {
  url: string;
  title: string;
  nodes: SnapshotNode[];
  /** korte samenvatting van de zichtbare paginatekst */
  textDigest: string;
  /** gebruikersoverschrijving van het site-profiel: "stealth" | "normal" | "fast" */
  siteProfileOverride?: string;
}
