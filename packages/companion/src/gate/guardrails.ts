import type { Action } from "@yad/shared";

/**
 * De Poort: harde grenzen in code, niet door de LLM te beoordelen.
 * - deny-lijst: betalen/bestellen/checkout/verwijderen wordt NOOIT uitgevoerd.
 * - confirm-before-act: schrijf-/onomkeerbare acties vereisen menselijke bevestiging.
 */

export const DENY_PATHS = [
  "/payment",
  "/checkout",
  "/placeorder",
  "/confirm",
  "/order/",
  "/order",
];

const DENY_WORDS =
  /\b(betaal|afrekenen|bestel|plaats\s*bestelling|checkout|pay\s*now|place\s*order|delete\s*account|account\s*verwijderen)\b/i;

const CONFIRM_WORDS =
  /\b(opslaan|save|verstuur|verzend|send|submit|bevestig|confirm|verwijder|delete|update|wijzig|aanmaken|create|betaal|bestel)\b/i;

export interface GateContext {
  currentUrl: string;
  /** zichtbare naam van het doel-element (uit de snapshot), indien bekend */
  targetName?: string;
}

export interface GateVerdict {
  denied: boolean;
  reason?: string;
}

export function pathIsDenied(url: string, base?: string): boolean {
  try {
    const u = new URL(url, base ?? "http://local.invalid");
    const p = u.pathname.toLowerCase();
    return DENY_PATHS.some((d) => p.includes(d));
  } catch {
    const s = url.toLowerCase();
    return DENY_PATHS.some((d) => s.includes(d));
  }
}

/** Harde weigering: deze actie mag absoluut niet uitgevoerd worden. */
export function checkDenied(action: Action, ctx: GateContext): GateVerdict {
  if (action.kind === "navigate" && pathIsDenied(action.url, ctx.currentUrl)) {
    return { denied: true, reason: "navigatie naar een betaal-/bestel-pad" };
  }
  if (action.kind === "click" || action.kind === "type" || action.kind === "select") {
    if (pathIsDenied(ctx.currentUrl)) {
      return { denied: true, reason: "actie op een betaal-/checkout-pagina" };
    }
    if (ctx.targetName && DENY_WORDS.test(ctx.targetName)) {
      return { denied: true, reason: "doelwit lijkt op betalen/bestellen/verwijderen" };
    }
  }
  return { denied: false };
}

/** Vereist deze actie expliciete bevestiging van de gebruiker? */
export function needsConfirm(action: Action, ctx: GateContext): boolean {
  switch (action.kind) {
    case "extract":
    case "wait":
    case "finish":
      return false;
    case "navigate":
      try {
        return new URL(action.url, ctx.currentUrl).origin !== new URL(ctx.currentUrl).origin;
      } catch {
        return true;
      }
    case "select":
      return true;
    case "type":
      return action.submit === true || (ctx.targetName ? CONFIRM_WORDS.test(ctx.targetName) : false);
    case "click":
      return ctx.targetName ? CONFIRM_WORDS.test(ctx.targetName) : false;
    default:
      return true;
  }
}
