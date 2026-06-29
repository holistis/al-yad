/**
 * Akkoord-poort (click-wrap): niemand gebruikt Yad zonder eerst expliciet akkoord
 * te geven. De exacte teksten worden definitief gemaakt vanuit de juridische
 * documenten; dit is de afdwingbare structuur + bewijsvastlegging.
 *
 * Bij een nieuwe ACCEPTANCE_VERSION moet de gebruiker opnieuw akkoord geven.
 */
export const ACCEPTANCE_VERSION = "2026-06-29.1";

export interface AcceptItem {
  id: string;
  text: string;
}

/** Losse, NIET voor-aangevinkte checkboxes. Alle vier verplicht. */
export const ACCEPT_ITEMS: AcceptItem[] = [
  { id: "av", text: "Ik ga akkoord met de Algemene Voorwaarden." },
  { id: "privacy", text: "Ik ga akkoord met de Privacyverklaring." },
  { id: "gebruik", text: "Ik ga akkoord met het Gebruiksbeleid." },
  {
    id: "verantwoordelijk",
    text:
      "Ik bevestig dat ik zelf verantwoordelijk en bevoegd ben om de systemen die ik met Yad " +
      "automatiseer te gebruiken, en dat Yad niet aansprakelijk is voor account-blokkades of het " +
      "schenden van de voorwaarden van andere websites.",
  },
];

export const ACCEPT_SUMMARY =
  "Yad werkt in jouw eigen, al-ingelogde browser en doet alleen wat jij hem opdraagt. " +
  "Jij blijft de baas en bent zelf verantwoordelijk voor wat je ermee doet en waar je het op gebruikt. " +
  "Lees de drie documenten, vink alles aan om te starten.";

export interface AcceptanceRecord {
  version: string;
  acceptedAt: string;
  items: string[];
}

const STORAGE_KEY = "yad_acceptance";

export async function getAcceptance(): Promise<AcceptanceRecord | null> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const rec = data[STORAGE_KEY] as AcceptanceRecord | undefined;
  return rec ?? null;
}

export async function isAccepted(): Promise<boolean> {
  const rec = await getAcceptance();
  return rec?.version === ACCEPTANCE_VERSION;
}

export async function recordAcceptance(): Promise<AcceptanceRecord> {
  const rec: AcceptanceRecord = {
    version: ACCEPTANCE_VERSION,
    acceptedAt: new Date().toISOString(),
    items: ACCEPT_ITEMS.map((i) => i.id),
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: rec });
  return rec;
}
