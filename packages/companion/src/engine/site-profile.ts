/**
 * Site-profiel: classificeert een URL in een gedragstier.
 *
 * stealth — anti-bot sites (LinkedIn, socials, Amazon, ticketing): langzame,
 *   mensachtige acties + karakter-voor-karakter typen.
 * normal  — gewone webshops, portalen, publieke sites: standaard tempo.
 * fast    — lokale/interne netwerken: minimale pauze, direct invullen.
 *
 * Nieuwe domeinen toevoegen: zet ze in STEALTH_HOSTS of een FAST_PATTERNS-regex.
 */

export type SiteTier = "stealth" | "normal" | "fast";

export interface SiteProfile {
  tier: SiteTier;
  /** Basis-pauze tussen acties (ms). humanPause() jittert hieroverheen. */
  pacingMs: number;
  /** Vertraging per teken bij typen (ms, 0 = direct invullen). */
  typeDelayMs: number;
  /** Extra wacht na scrollIntoView vóór klik (ms, 0 = geen extra). */
  scrollPauseMs: number;
}

const STEALTH_HOSTS: readonly string[] = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "threads.net",
  "twitter.com",
  "x.com",
  "glassdoor.com",
  "glassdoor.nl",
  "indeed.com",
  "indeed.nl",
  "amazon.com",
  "amazon.nl",
  "amazon.de",
  "amazon.fr",
  "amazon.co.uk",
  "amazon.be",
  "ticketmaster.com",
  "ticketmaster.nl",
  "ticketmaster.be",
  "eventbrite.com",
  "eventbrite.nl",
  "eventbrite.be",
];

const FAST_PATTERNS: readonly RegExp[] = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/[^/]+\.local(\/|$)/i,
];

const PROFILES: Record<SiteTier, SiteProfile> = {
  stealth: { tier: "stealth", pacingMs: 4000, typeDelayMs: 85, scrollPauseMs: 600 },
  normal: { tier: "normal", pacingMs: 1800, typeDelayMs: 0, scrollPauseMs: 0 },
  fast: { tier: "fast", pacingMs: 200, typeDelayMs: 0, scrollPauseMs: 0 },
};

/** Geeft het profiel direct op basis van een tier (voor gebruikersoverschrijvingen). */
export function getProfileByTier(tier: SiteTier): SiteProfile {
  return PROFILES[tier];
}

export function getSiteProfile(url: string): SiteProfile {
  if (!url || url === "about:blank") return PROFILES.normal;
  try {
    const { hostname } = new URL(url);
    const bare = hostname.toLowerCase().replace(/^www\./, "");
    if (STEALTH_HOSTS.some((h) => bare === h || bare.endsWith("." + h))) {
      return PROFILES.stealth;
    }
    if (FAST_PATTERNS.some((p) => p.test(url))) {
      return PROFILES.fast;
    }
  } catch {
    /* ongeldige URL → normal */
  }
  return PROFILES.normal;
}
