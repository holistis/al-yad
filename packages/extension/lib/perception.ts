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
].join(",");


function isVisible(el: Element): boolean {
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

function roleOf(el: Element): string {
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
    return "textbox";
  }
  if ((el as HTMLElement).isContentEditable) return "textbox";
  return tag;
}

function labelFor(el: Element): string {
  const id = el.getAttribute("id");
  if (id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lbl?.textContent) return lbl.textContent.trim();
  }
  const closest = el.closest("label");
  if (closest?.textContent) return closest.textContent.trim();
  return "";
}

function nameOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labelled = el.getAttribute("aria-labelledby");
  if (labelled) {
    const ref = document.getElementById(labelled);
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

function valueOf(el: Element): string | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const v = (el as HTMLInputElement).value;
    return v ? v.slice(0, 120) : undefined;
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
