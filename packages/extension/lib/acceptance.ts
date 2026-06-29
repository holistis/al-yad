/**
 * Akkoord-poort (click-wrap): niemand gebruikt Yad zonder eerst expliciet akkoord
 * te geven. Teksten en structuur volgen de juridische spec (docs/legal/akkoord-poort.md):
 * vijf losse, NIET voor-aangevinkte verplichte checkboxes + plain-language samenvatting.
 *
 * Bij een nieuwe ACCEPTANCE_VERSION moet de gebruiker opnieuw akkoord geven.
 */
export const ACCEPTANCE_VERSION = "2026-06-29.1";

export interface AcceptItem {
  id: string;
  text: string;
}

/** Losse, NIET voor-aangevinkte verplichte checkboxes. Alle vijf verplicht. */
export const ACCEPT_ITEMS: AcceptItem[] = [
  {
    id: "av",
    text: `Ik heb de Algemene Voorwaarden (versie ${ACCEPTANCE_VERSION}) gelezen en ik ga daarmee akkoord.`,
  },
  {
    id: "privacy",
    text: "Ik heb de Privacyverklaring gelezen en ik begrijp hoe mijn gegevens worden verwerkt.",
  },
  {
    id: "aup",
    text: "Ik heb het Gebruiksbeleid gelezen en ik houd mij aan de toegestane manier van gebruik.",
  },
  {
    id: "authority",
    text:
      "Ik verklaar dat ik zelf verantwoordelijk en bevoegd ben om de systemen en accounts die ik met " +
      "deze tool automatiseer ook daadwerkelijk te automatiseren. Ik gebruik de tool alleen op systemen " +
      "die van mij zijn of waarvoor ik aantoonbaar toestemming van de rechthebbende heb.",
  },
  {
    id: "liability",
    text:
      "Ik begrijp en aanvaard dat ik zelf verantwoordelijk ben voor het naleven van de voorwaarden van " +
      "systemen en diensten van derden die ik automatiseer. Yad is niet aansprakelijk voor blokkades of " +
      "schorsingen van mijn accounts, noch voor schade door het schenden van voorwaarden of regels van " +
      "derden door mijn gebruik.",
  },
];

/** Plain-language samenvatting (mensentaal) boven de checkboxes. */
export const ACCEPT_SUMMARY = [
  "Voordat je begint, even kort en eerlijk.",
  "",
  "Met deze tool automatiseer je werk op systemen en accounts. Jij bepaalt zelf op welke systemen je dit gebruikt. Daarom geldt: jij moet daar zelf toestemming voor hebben.",
  "",
  "Veel websites en diensten hebben eigen regels. Soms mag je daar niet automatiseren of niet inloggen met een bot. Als jij die regels breekt, kan jouw account geblokkeerd worden. Dat risico ligt bij jou, want jij kiest waar je de tool inzet.",
  "",
  "Wij bouwen de tool met zorg. Maar wij weten niet op welke systemen jij hem loslaat. Daarom kunnen wij niet aansprakelijk zijn voor een blokkade van jouw account, en ook niet als jij de voorwaarden van een ander bedrijf breekt.",
  "",
  "Wij gaan netjes om met je gegevens. We verkopen je gegevens niet. Lees rustig, en vink alleen aan wat klopt voor jou.",
].join("\n");

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
