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
