import type { Snapshot, SnapshotNode } from "@yad/shared";
import { normalizeText, SNAPSHOT_LIMITS } from "@yad/shared";

/**
 * De Ogen: bouwt een compacte perceptie van de pagina. Verzamelt alleen
 * interactieve, zichtbare elementen met een stabiel ref-id (e1, e2, ...) en een
 * korte tekst-samenvatting. Open shadow DOM wordt meegenomen (web components);
 * onzichtbare unicode en aria-hidden worden geweerd (anti prompt-injectie / ruis).
 */

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "[role=button]",
  "[role=link]",
  "[role=textbox]",
  "[role=combobox]",
  "[role=checkbox]",
  "[contenteditable=true]",
  "[onclick]",
  "summary",
  // Een sleepbaar element IS interactief, ook al is het een kale div. Zonder deze regel
  // zag de agent sleephandvatten en herordenbare lijstitems helemaal niet, en kon hij de
  // drag-actie dus nergens op richten. Kwam boven bij het live testen van die actie:
  // de handeling werkte, maar er was geen enkel element om hem op uit te voeren.
  "[draggable=true]",
  // Alles met een tabindex is met het toetsenbord bereikbaar en dus per definitie
  // bedoeld om mee te werken. Dit vangt dropzones, custom widgets en kaarten die geen
  // standaardrol dragen. `-1` blijft buiten beeld: dat betekent juist "wel focusbaar
  // via script, niet in de tab-volgorde", en die zijn zelden een doel op zich.
  '[tabindex]:not([tabindex="-1"])',
  // Items inside custom (non-native) dropdown/menu popovers — React-Select, MUI, Radix, etc.
  // render these via a portal after the trigger (role=button/combobox) is clicked. Without these,
  // the popover's options never enter the snapshot and the agent re-clicks the trigger forever.
  // Matches what prompt.ts already promises the model ("appear as role=option/menuitem/listitem").
  "[role=option]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=listitem]",
  "[role=tab]",
].join(",");


export function isVisible(el: Element): boolean {
  // input[type=file] is vrijwel altijd via CSS verborgen (opacity:0, width:0, position:absolute)
  // maar is wél interactief via DataTransfer — altijd opnemen zodat upload-local het kan vinden.
  if (el instanceof HTMLInputElement && el.type.toLowerCase() === "file") return true;
  const he = el as HTMLElement;
  if (he.hidden) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (el.closest("[aria-hidden=true]")) return false;
  const rect = he.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(he);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

/** Verzamelt interactieve elementen inclusief open shadow DOM (web components). */
function collectInteractive(
  root: Document | ShadowRoot,
  selector: string,
  out: Element[],
  budget = { n: 4000 },
): void {
  const all = root.querySelectorAll("*");
  for (const el of all) {
    if (budget.n-- <= 0) return;
    if (el.matches(selector)) out.push(el);
    const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) collectInteractive(sr, selector, out, budget);
  }
}

export function roleOf(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    if (t === "button" || t === "submit" || t === "reset") return "button";
    if (t === "file") return "file-input";
    return "textbox";
  }
  if ((el as HTMLElement).isContentEditable) return "textbox";
  return tag;
}

/**
 * Shadow-DOM-bewust querySelectorAll: doorzoekt recursief alle open shadow roots.
 * Nodig omdat document.querySelector() stopt bij de shadow boundary.
 */
function queryDeep(root: Document | ShadowRoot | Element, selector: string): Element | null {
  const found = (root as Document | Element).querySelector(selector);
  if (found) return found;
  const all = (root as Document | Element).querySelectorAll("*");
  for (const el of all) {
    const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) {
      const r = queryDeep(sr, selector);
      if (r) return r;
    }
  }
  return null;
}

function getElementByIdDeep(id: string): Element | null {
  return queryDeep(document, `#${CSS.escape(id)}`);
}

function labelFor(el: Element): string {
  const id = el.getAttribute("id");
  if (id) {
    // Zoek eerst in het reguliere DOM, dan in shadow roots
    const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`)
      ?? queryDeep(document, `label[for="${CSS.escape(id)}"]`);
    if (lbl?.textContent) return lbl.textContent.trim();
  }
  const closest = el.closest("label");
  if (closest?.textContent) return closest.textContent.trim();
  return "";
}

export function nameOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labelled = el.getAttribute("aria-labelledby");
  if (labelled) {
    // document.getElementById gaat niet door shadow roots — gebruik deep variant
    const ref = document.getElementById(labelled) ?? getElementByIdDeep(labelled);
    if (ref?.textContent) return ref.textContent.trim();
  }
  const lbl = labelFor(el);
  if (lbl) return lbl;
  const he = el as HTMLInputElement;
  if (he.placeholder) return he.placeholder.trim();
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (text) return text;
  return (
    el.getAttribute("title")?.trim() ||
    el.getAttribute("alt")?.trim() ||
    el.getAttribute("name")?.trim() ||
    ""
  );
}

/**
 * Is dit een veld waarvan de inhoud nooit de pagina mag verlaten?
 *
 * De waarneming van elk veld gaat mee in de prompt naar het taalmodel. Zonder deze
 * controle ging de inhoud van een wachtwoordveld dus gewoon mee naar de cloudprovider —
 * ook wanneer de browser het veld zelf had ingevuld en de gebruiker er niets van wist.
 * Het model heeft die waarde nergens voor nodig: dat een wachtwoordveld gevuld is, is de
 * enige informatie die telt, en die geven we hieronder als "(ingevuld)".
 *
 * Naast type=password ook op de autocomplete-hint controleren, want sites bouwen
 * wachtwoordvelden regelmatig als type=text met een zichtbaar-maken-knop ernaast.
 */
function isGeheimVeld(el: Element): boolean {
  if ((el as HTMLInputElement).type === "password") return true;
  const hint = el.getAttribute("autocomplete")?.toLowerCase() ?? "";
  return hint.includes("password") || hint === "one-time-code" || hint === "cc-number" || hint === "cc-csc";
}

function valueOf(el: Element): string | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const v = (el as HTMLInputElement).value;
    if (!v) return undefined;
    if (isGeheimVeld(el)) return "(ingevuld)";
    return v.slice(0, 120);
  }
  if (tag === "a") {
    const href = (el as HTMLAnchorElement).href;
    return href && href.startsWith("http") ? href.slice(0, 200) : undefined;
  }
  return undefined;
}

export function buildSnapshot(refMap: Map<string, Element>, maxNodes = SNAPSHOT_LIMITS.MAX_NODES): Snapshot {
  refMap.clear();
  const nodes: SnapshotNode[] = [];
  const seen = new Set<Element>();

  const elements: Element[] = [];
  const budget = { n: 4000 };
  collectInteractive(document, INTERACTIVE_SELECTOR, elements, budget);

  // Same-origin iframes meenemen (cross-origin gooit een SecurityError bij .contentDocument).
  for (const iframe of document.querySelectorAll("iframe")) {
    try {
      const idoc = iframe.contentDocument;
      if (idoc) collectInteractive(idoc, INTERACTIVE_SELECTOR, elements, budget);
    } catch {
      // cross-origin of gesloten shadow: niet-inspecteerbaar, overslaan
    }
  }

  let i = 0;
  for (const el of elements) {
    if (nodes.length >= maxNodes) break;
    if (seen.has(el) || !isVisible(el)) continue;
    seen.add(el);

    const ref = `e${++i}`;
    refMap.set(ref, el);
    const node: SnapshotNode = {
      ref,
      role: roleOf(el),
      name: normalizeText(nameOf(el)).slice(0, SNAPSHOT_LIMITS.NAME_LIMIT),
    };
    const value = valueOf(el);
    if (value) node.value = normalizeText(value);
    if ((el as HTMLButtonElement).disabled) node.disabled = true;
    nodes.push(node);
  }

  const textDigest = normalizeText(document.body?.innerText || "").slice(0, SNAPSHOT_LIMITS.DIGEST_LIMIT);

  return {
    url: location.href,
    title: normalizeText(document.title),
    nodes,
    textDigest,
  };
}

/**
 * Zoekt een element opnieuw op zijn rol+naam in de levende pagina, in plaats van op
 * een (mogelijk verouderde) refMap-verwijzing te vertrouwen.
 *
 * Op snel her-renderende pagina's (React/Vue-SPA's) kan het knooppunt achter een ref
 * tussen het maken van de snapshot en het uitvoeren van de actie al vervangen zijn
 * door een nieuw DOM-element met dezelfde tekst. De oude refMap-verwijzing bestaat
 * dan niet meer, of wijst naar een losgekoppeld knooppunt dat een actie accepteert
 * zonder enig zichtbaar effect. Ontdekt tijdens een echte Power BI-sessie (Research
 * Log #1, 2026-08-28) en opnieuw op Cloudflare's dashboard (2026-08-29) — beide keren
 * meldde de actie "ok:true" terwijl de pagina niet veranderde. Toen een handmatige
 * ingreep; dit maakt het een automatische stap.
 */
export function findFresh(root: Document | ShadowRoot, role: string, name: string): Element | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const elements: Element[] = [];
  collectInteractive(root, INTERACTIVE_SELECTOR, elements, { n: 4000 });
  const target = trimmed.toLowerCase();
  let roleMismatch: Element | null = null;
  for (const el of elements) {
    if (!isVisible(el)) continue;
    if (nameOf(el).trim().toLowerCase() !== target) continue;
    if (roleOf(el) === role) return el; // exacte match op rol EN naam
    if (!roleMismatch) roleMismatch = el; // bewaar als reserve — rol kan legitiem licht afwijken
  }
  return roleMismatch;
}
