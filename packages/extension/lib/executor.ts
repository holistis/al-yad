import type { Action, ActResult } from "@yad/shared";

/**
 * De uitvoerder (in de pagina-context): voert een Action deterministisch uit op
 * het element achter de ref. Navigeren en finish horen NIET hier (die handelt de
 * achtergrond/het Brein af).
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // React/Vue luisteren op de native setter; daarom via de prototype-setter.
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function executeAction(
  action: Action,
  refMap: Map<string, Element>,
): Promise<ActResult> {
  switch (action.kind) {
    case "wait":
      await sleep(Math.min(action.ms, 15_000));
      return { ok: true };

    case "extract": {
      if (action.ref) {
        const el = refMap.get(action.ref);
        if (!el) return { ok: false, detail: `ref ${action.ref} niet gevonden` };
        return { ok: true, extracted: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 2000) };
      }
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 2000);
      return { ok: true, extracted: text };
    }

    case "click": {
      const el = refMap.get(action.ref);
      if (!el) return { ok: false, detail: `ref ${action.ref} niet gevonden` };
      (el as HTMLElement).scrollIntoView({ block: "center" });
      (el as HTMLElement).click();
      return { ok: true };
    }

    case "type": {
      const el = refMap.get(action.ref) as HTMLInputElement | HTMLTextAreaElement | HTMLElement | undefined;
      if (!el) return { ok: false, detail: `ref ${action.ref} niet gevonden` };
      (el as HTMLElement).scrollIntoView({ block: "center" });
      (el as HTMLElement).focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        setNativeValue(el, action.text);
      } else if ((el as HTMLElement).isContentEditable) {
        (el as HTMLElement).textContent = action.text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        return { ok: false, detail: "element is geen invoerveld" };
      }
      if (action.submit) {
        const form = (el as HTMLElement).closest("form");
        if (form) {
          form.requestSubmit?.() ?? form.submit();
        } else {
          el.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }),
          );
        }
      }
      return { ok: true };
    }

    case "select": {
      const el = refMap.get(action.ref);
      if (!(el instanceof HTMLSelectElement)) {
        return { ok: false, detail: `ref ${action.ref} is geen keuzelijst` };
      }
      el.value = action.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }

    case "navigate":
    case "finish":
      return { ok: false, detail: "deze actie hoort niet in de pagina-context" };
  }
}
