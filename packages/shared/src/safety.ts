/**
 * Gedeeld veiligheidspatroon voor het herkennen van betaal-/bestel-/account-verwijder-
 * knoppen aan hun zichtbare tekst. Gebruikt door de companion (guardrails.ts, voor
 * ref-based clicks met een gekende accessible name) EN door de extension (executor.ts,
 * voor click-at waar geen ref bestaat en de tekst pas na elementFromPoint bekend is).
 * Eén bron voorkomt dat de twee kopieen uit elkaar groeien.
 */
export const DENY_WORDS =
  /\b(betaal|afrekenen|kassa|naar\s*de\s*kassa|kasse|caisse|bestel|plaats\s*bestelling|checkout|pay\s*now|place\s*order|delete\s*account|account\s*verwijderen)\b/i;
