/**
 * Gedeeld veiligheidspatroon voor het herkennen van betaal-/bestel-/account-verwijder-
 * knoppen aan hun zichtbare tekst. Gebruikt door de companion (guardrails.ts, voor
 * ref-based clicks met een gekende accessible name) EN door de extension (executor.ts,
 * voor click-at waar geen ref bestaat en de tekst pas na elementFromPoint bekend is).
 * Eén bron voorkomt dat de twee kopieen uit elkaar groeien.
 */
export const DENY_WORDS =
  /\b(betalen|betaal\w*|afrekenen|kassa|naar\s*de\s*kassa|kasse|caisse|bestel\w*|plaats\s*bestelling|bevestig\s*(en\s*)?(betaal\w*|bestelling|aankoop)|checkout|pay\s*now|buy\s*now|purchase|complete\s*(order|purchase|checkout)|finish\s*(order|purchase|checkout)|confirm\s*(and\s*)?(pay|payment|purchase|order)|place\s*order|delete\s*account|account\s*verwijderen)\b/i;
