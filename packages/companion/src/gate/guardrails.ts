import { DENY_WORDS, type Action } from "@yad/shared";

/**
 * De Poort: harde grenzen in code, niet door de LLM te beoordelen.
 * - scheme-allowlist: alleen http/https; javascript:/data:/file:/chrome:/blob: geweigerd.
 * - deny-lijst: betalen/bestellen/checkout/verwijderen wordt NOOIT uitgevoerd,
 *   ook niet via percent-encoding of een onbekende/lege URL (fail-safe).
 * - confirm-before-act: schrijf-/onomkeerbare acties vereisen menselijke bevestiging,
 *   gebaseerd op de ROL van het element (niet alleen op de door de pagina geleverde naam).
 */

export const DENY_PATHS = [
  "/payment",
  "/checkout",
  "/placeorder",
  "/confirm",
  "/order/",
  "/order",
  // Nederlandse webshops routeren checkout vaak onder een Nederlands pad in
  // plaats van het Engelse "/checkout" (adversariele review 2026-09-11,
  // finding 24: DENY_PATHS was Engels-only terwijl DENY_WORDS al wel
  // Nederlandse knoptekst dekte).
  "/afrekenen",
  "/bestellen",
  "/bestelling",
  "/betalen",
  "/kassa",
];

const SAFE_SCHEMES = ["http:", "https:"];

/**
 * Bekende betaalverwerker-hostnamen. Hun eigen betaalpagina's volgen vaak geen
 * /payment-/checkout-/order-padstructuur (Stripe's eigen checkout draait bv. op
 * checkout.stripe.com/c/pay/cs_test_xxx, zonder "checkout" of "payment" in het pad
 * zelf), dus DENY_PATHS mist deze structureel. Niet uitputtend: defense-in-depth
 * naast de pad-check, niet de enige laag.
 */
const PAYMENT_HOSTS = [
  "checkout.stripe.com",
  "buy.stripe.com",
  "paypal.com",
  "www.paypal.com",
  "checkout.mollie.com",
  "checkoutshopper-live.adyen.com",
  "checkoutshopper-test.adyen.com",
  "secure.worldpay.com",
  "pay.google.com",
  "checkout.klarna.com",
  "checkout.shopify.com",
];

function isPaymentHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return PAYMENT_HOSTS.some((h) => lower === h || lower.endsWith(`.${h}`));
}

const CONFIRM_WORDS =
  /\b(opslaan|save|verstuur|verzend|send|submit|bevestig|confirm|verwijder|delete|update|wijzig|aanmaken|create|betaal|bestel)\b/i;

/** Rollen waarbij een klik standaard als muterend wordt behandeld (confirm vereist). */
const WRITE_ROLES = /^(button|submit|checkbox|radio|menuitem|tab|switch)$/i;

export interface GateContext {
  currentUrl: string;
  /** zichtbare naam van het doel-element (uit de snapshot), indien bekend */
  targetName?: string;
  /** rol van het doel-element (uit de snapshot) */
  role?: string;
}

export interface GateVerdict {
  denied: boolean;
  reason?: string;
}

/** Decodeer herhaald (gedicht tegen dubbel-encoding) tot stabiel, met een harde cap. */
function decodeDeep(s: string): string {
  let cur = s;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(cur);
    } catch {
      return cur;
    }
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

function matchesDenyPath(segment: string): boolean {
  const lower = segment.toLowerCase();
  const variants = new Set<string>([lower, decodeDeep(lower)]);
  for (const v of variants) {
    if (DENY_PATHS.some((d) => v.includes(d))) return true;
  }
  return false;
}

/**
 * Is dit (na normalisatie) een betaal-/bestel-pad? Controleert pathname, query EN
 * hash-fragment: SPA's routeren checkout vaak via de hash (#/checkout), wat anders
 * door de pathname-check zou glippen. Conservatief: liever te streng dan een
 * bestelling/betaling toelaten (de harde rode lijn).
 */
export function pathIsDenied(url: string, base?: string): boolean {
  try {
    const u = new URL(url, base ?? "http://local.invalid");
    if (isPaymentHost(u.hostname)) return true;
    return matchesDenyPath(u.pathname) || matchesDenyPath(u.hash) || matchesDenyPath(u.search);
  } catch {
    const s = String(url).toLowerCase();
    const decoded = decodeDeep(s);
    return DENY_PATHS.some((d) => s.includes(d) || decoded.includes(d));
  }
}

/** Alleen http/https zijn toegestaan als navigatie-doel. */
export function isAllowedScheme(url: string, base?: string): boolean {
  try {
    return SAFE_SCHEMES.includes(new URL(url, base).protocol);
  } catch {
    return false;
  }
}

/** Onbekend = leeg, niet-parseerbaar, of geen http/https. Dan handelen we fail-safe. */
export function isUnknownUrl(url: string): boolean {
  if (!url || !url.trim()) return true;
  try {
    return !SAFE_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return true;
  }
}

/** Harde weigering: deze actie mag absoluut niet uitgevoerd worden. */
export function checkDenied(action: Action, ctx: GateContext): GateVerdict {
  if (action.kind === "navigate") {
    const base = isUnknownUrl(ctx.currentUrl) ? undefined : ctx.currentUrl;
    if (!isAllowedScheme(action.url, base)) {
      return { denied: true, reason: "alleen http/https-adressen zijn toegestaan" };
    }
    if (pathIsDenied(action.url, base)) {
      return { denied: true, reason: "navigatie naar een betaal-/bestel-pad" };
    }
    return { denied: false };
  }

  if (action.kind === "click" || action.kind === "click-at" || action.kind === "type" || action.kind === "select" || action.kind === "paste" || action.kind === "upload") {
    // fail-safe: zonder bekende, geldige pagina-URL weigeren we muterende acties.
    if (isUnknownUrl(ctx.currentUrl)) {
      return { denied: true, reason: "onbekende of niet-toegestane pagina-URL" };
    }
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
      // Vanaf een lege/onbekende pagina (verse tab, about:blank) is er geen origin
      // om te beschermen: de eerste navigatie (bv. 'ga naar nu.nl') hoeft geen
      // bevestiging. checkDenied blokkeert hier nog steeds non-http en betaal-paden.
      if (isUnknownUrl(ctx.currentUrl)) return false;
      try {
        return new URL(action.url, ctx.currentUrl).origin !== new URL(ctx.currentUrl).origin;
      } catch {
        return true;
      }
    case "select":
      return true;
    case "upload":
      return true; // bestandsupload altijd bevestigen
    case "type":
    case "paste":
      // typen/plakken-met-verzenden altijd bevestigen; anders bij muterende labels.
      return action.submit === true || (ctx.targetName ? CONFIRM_WORDS.test(ctx.targetName) : false);
    case "click":
      // fail-closed: elke klik op een muterende ROL bevestigen, ongeacht het (door de
      // pagina geleverde) label; CONFIRM_WORDS vangt daarbovenop muterende links.
      if (ctx.role && WRITE_ROLES.test(ctx.role)) return true;
      return ctx.targetName ? CONFIRM_WORDS.test(ctx.targetName) : false;
    default:
      return true;
  }
}
