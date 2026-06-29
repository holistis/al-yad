import type { Snapshot, SnapshotNode } from "@yad/shared";

/**
 * De Ogen: bouwt een compacte perceptie van de pagina. Verzamelt alleen
 * interactieve, zichtbare elementen met een stabiel ref-id (e1, e2, ...) en een
 * korte tekst-samenvatting. De ref->element map wordt gevuld zodat de executor
 * later op ref kan handelen i.p.v. op broze selectors.
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
  const rect = he.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(he);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
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

export function buildSnapshot(refMap: Map<string, Element>, maxNodes = 150): Snapshot {
  refMap.clear();
  const nodes: SnapshotNode[] = [];
  const seen = new Set<Element>();

  const elements = document.querySelectorAll(INTERACTIVE_SELECTOR);
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
      name: nameOf(el).slice(0, 120),
    };
    const value = valueOf(el);
    if (value) node.value = value;
    if ((el as HTMLButtonElement).disabled) node.disabled = true;
    nodes.push(node);
  }

  const textDigest = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1500);

  return {
    url: location.href,
    title: document.title,
    nodes,
    textDigest,
  };
}
