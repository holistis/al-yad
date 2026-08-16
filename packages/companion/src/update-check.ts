/**
 * Update-controle: weet de klant dat er een nieuwe versie is, en haalt hem op.
 *
 * WAT WEL EN NIET AUTOMATISCH KAN — eerlijk, want dit is een productbelofte:
 *
 *   De COMPANION (dit Node-proces) kan zichzelf bijwerken. Het is ons eigen proces op de
 *   machine van de klant, dus we mogen bestanden vervangen en herstarten. Hier zit ook
 *   verreweg het meeste van de logica: de agent-lus, herstel, waarneming, alle acties.
 *
 *   De EXTENSIE kan dat niet. Chrome staat niet toe dat een extensie zichzelf van een
 *   willekeurige server bijwerkt; dat is een beveiligingsregel, geen ontbrekende functie.
 *   Alleen via de Chrome Web Store gebeurt dat vanzelf. Een uitgepakte extensie werkt
 *   nooit vanzelf bij. Wij kunnen wél detecteren dat er een nieuwe is en dat melden.
 *
 *   HET BELANGRIJKSTE DEEL HOEFT HELEMAAL NIET BIJGEWERKT. Weten hoe je met een lastige
 *   site omgaat komt van het gedeelde herstelbrein op de server. Dat is meteen bij
 *   iedereen zodra het één keer geleerd is, zonder dat er ook maar iets verstuurd wordt.
 *   Dat is de echte "automatische update", en de enige die per direct werkt.
 *
 * De controle is bewust stil en zonder gevolgen: hij mag een run nooit ophouden en nooit
 * laten mislukken. Een klant die offline werkt, merkt er niets van.
 */

export interface UpdateInfo {
  /** Is er een nieuwere versie dan wat hier draait? */
  nieuwer: boolean;
  huidig: string;
  beschikbaar?: string;
  datum?: string;
  wijzigingen?: string[];
  downloadUrl?: string;
  /** Kan dit onderdeel zichzelf bijwerken, of moet de gebruiker iets doen? */
  zelfBijwerkbaar: boolean;
  reden?: string;
}

const STANDAARD_BRON = "https://wazir-x402.duckdns.org/yad-update/version.json";

/**
 * Vergelijkt twee versies als `1.2.3`. Geen semver-bibliotheek: die kan meer dan we
 * nodig hebben en zou een afhankelijkheid toevoegen voor drie regels rekenwerk.
 */
export function isNieuwer(beschikbaar: string, huidig: string): boolean {
  const a = String(beschikbaar).split(".").map((x) => parseInt(x, 10) || 0);
  const b = String(huidig).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return false;
}

export async function checkUpdate(huidigeVersie: string, bron?: string): Promise<UpdateInfo> {
  const url = bron ?? process.env["YAD_UPDATE_URL"] ?? STANDAARD_BRON;
  const basis: UpdateInfo = { nieuwer: false, huidig: huidigeVersie, zelfBijwerkbaar: true };

  // Uit kunnen zetten: een klant in een afgesloten omgeving wil misschien helemaal geen
  // verkeer naar buiten, ook niet voor een versiecontrole.
  if (process.env["YAD_UPDATE_CHECK"] === "uit") {
    return { ...basis, reden: "uitgezet via YAD_UPDATE_CHECK" };
  }

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return { ...basis, reden: `versiebestand gaf HTTP ${r.status}` };
    const d = (await r.json()) as {
      versie?: string; datum?: string; wijzigingen?: string[]; downloadUrl?: string;
    };
    if (!d.versie) return { ...basis, reden: "versiebestand zonder versienummer" };
    return {
      nieuwer: isNieuwer(d.versie, huidigeVersie),
      huidig: huidigeVersie,
      beschikbaar: d.versie,
      ...(d.datum ? { datum: d.datum } : {}),
      ...(d.wijzigingen ? { wijzigingen: d.wijzigingen } : {}),
      ...(d.downloadUrl ? { downloadUrl: d.downloadUrl } : {}),
      zelfBijwerkbaar: true,
    };
  } catch (e) {
    // Offline of server plat: dat is geen fout van de klant en mag niets kapotmaken.
    return { ...basis, reden: `niet bereikbaar: ${(e as Error).message.slice(0, 60)}` };
  }
}
