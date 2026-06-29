import type { Action, ActResult } from "@yad/shared";

/**
 * De uitvoerder (in de pagina-context): voert een Action deterministisch uit op
 * het element achter de ref. Navigeren en finish horen NIET hier (die handelt de
 * achtergrond/het Brein af).
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Klikbare tekst die wijst op een toestemming/cookie-banner (NL + EN + FR + DE).
const CONSENT_PATTERNS = /\b(accepteer|accepteren|accept all|alle cookies|alles accepteren|akkoord|agree|got it|i understand|ok|okay|sluiten|close|dismiss|toestaan|allow all|consent|i agree|verstanden|accepter|continuer|fermer)\b/i;

/** Probeert een zichtbare overlay/cookie-banner weg te klikken vóór een echte actie.
 *  Geeft true als er iets weggeklikt is (wacht dan even zodat de pagina kan updaten). */
async function tryDismissOverlay(): Promise<boolean> {
  const overlaySelectors = [
    "[class*='cookie']",
    "[class*='consent']",
    "[class*='gdpr']",
    "[class*='banner']",
    "[class*='modal']",
    "[id*='cookie']",
    "[id*='consent']",
    "[id*='gdpr']",
    "[role='dialog']",
    "[role='alertdialog']",
  ].join(",");

  const candidates = document.querySelectorAll(overlaySelectors);
  for (const overlay of candidates) {
    const buttons = overlay.querySelectorAll<HTMLElement>("button, [role=button], a[href='#'], input[type=button]");
    for (const btn of buttons) {
      const label = (btn.textContent || btn.getAttribute("aria-label") || "").trim();
      if (CONSENT_PATTERNS.test(label)) {
        btn.click();
        await sleep(400); // laat de pagina de overlay verwijderen
        return true;
      }
    }
  }
  return false;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // React/Vue luisteren op de native setter; daarom via de prototype-setter.
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Typt karakter-voor-karakter met willekeurige vertraging per teken.
 * Stuurt keydown/input/keyup events per karakter zodat React's synthetische
 * event-laag (LinkedIn, Gmail, etc.) elke toetsaanslag ziet — onmisbaar voor
 * sites die bot-achtig plakken detecteren.
 */
async function typeSlowly(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  baseDelayMs: number,
): Promise<void> {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  // Wis de bestaande waarde
  if (desc?.set) desc.set.call(el, "");
  else el.value = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));

  let built = "";
  for (const char of text) {
    built += char;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true, cancelable: true }));
    if (desc?.set) desc.set.call(el, built);
    else el.value = built;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
    // Jitter: base ± 50% zodat het patroon niet mechanisch is
    await sleep(Math.round(baseDelayMs * 0.5 + Math.random() * baseDelayMs));
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Typt karakter-voor-karakter in een contentEditable element (LinkedIn berichtvak,
 * Gmail compose, etc.) via document.execCommand zodat de DOM-mutatieobservers
 * van het framework de invoer als echte toetsaanslagen zien.
 */
async function typeSlowlyEditable(
  el: HTMLElement,
  text: string,
  baseDelayMs: number,
): Promise<void> {
  el.textContent = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  for (const char of text) {
    document.execCommand("insertText", false, char);
    await sleep(Math.round(baseDelayMs * 0.5 + Math.random() * baseDelayMs));
  }
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
      const scrollPause = action.scrollPause ?? 0;
      // Stealth-sites: smooth scrollen + wachten zodat het eruitziet als menselijk
      // scrollen naar het element. Andere sites: direct (auto).
      (el as HTMLElement).scrollIntoView({
        behavior: scrollPause > 0 ? "smooth" : "auto",
        block: "center",
      });
      if (scrollPause > 0) {
        await sleep(scrollPause); // wacht tot scroll klaar + menselijk aarzelen
      }

      // Overlay-check: controleer of het doel zichtbaar is via elementFromPoint.
      // Als er iets voor hangt dat op een consent-banner lijkt, probeer het eerst weg.
      const rect = (el as HTMLElement).getBoundingClientRect();
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);
      const topEl = document.elementFromPoint(cx, cy);
      if (topEl && !el.contains(topEl) && !topEl.contains(el as Node)) {
        const dismissed = await tryDismissOverlay();
        if (dismissed) await sleep(200); // extra wacht na dismiss
      }

      (el as HTMLElement).click();
      return { ok: true };
    }

    case "type": {
      const el = refMap.get(action.ref) as HTMLInputElement | HTMLTextAreaElement | HTMLElement | undefined;
      if (!el) return { ok: false, detail: `ref ${action.ref} niet gevonden` };
      (el as HTMLElement).scrollIntoView({ block: "center" });
      (el as HTMLElement).focus();
      const typeDelay = action.typeDelay ?? 0;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (typeDelay > 0) {
          await typeSlowly(el, action.text, typeDelay);
        } else {
          setNativeValue(el, action.text);
        }
      } else if ((el as HTMLElement).isContentEditable) {
        if (typeDelay > 0) {
          await typeSlowlyEditable(el as HTMLElement, action.text, typeDelay);
        } else {
          (el as HTMLElement).textContent = action.text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      } else {
        return { ok: false, detail: "element is geen invoerveld" };
      }
      // Lees terug: meld geen succes als het veld leeg bleef.
      const after =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.value
          : (el as HTMLElement).textContent || "";
      if (action.text && !after) {
        return { ok: false, detail: "invoer kwam niet aan (veld bleef leeg)" };
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
