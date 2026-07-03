/**
 * Signal-arbiter (Layer 3 — control decision).
 *
 * De agent-lus heeft acht "stuck"-detectoren die elk hetzelfde antwoord vroegen:
 * escaleer naar Claude Code, en stop als er geen herstelplan komt. Vroeger stond dat
 * escalatie-blok acht keer gekopieerd door de 900-regel lus — moeilijk te debuggen
 * ("waarom stopte hij?") en moeilijk uit te breiden (elk nieuw signaal = nog een kopie).
 *
 * Dit module centraliseert de KENNIS over die signalen — hun naam, hun ernst en hun
 * onderlinge rangorde — als PURE data en pure functies. Het neemt zelf GEEN beslissing
 * die I/O vereist en muteert geen lus-state; het rangschikt alleen wat de lus hem geeft.
 * De escalatie-RESPONS (de I/O: hand.update + escalate + stop) leeft in loop.ts, waar de
 * lus-state hoort.
 *
 * Ontwerpregels (gegrond in het signal-arbitration onderzoek):
 *  - Detectie is puur: een signaal is DATA (id + severity + evidence), geen actie.
 *  - HARD subsumeert SOFT: één hard signaal (omgeving stuk / aantoonbaar vast) is genoeg
 *    en gaat vóór elke hoeveelheid zachte twijfel. Dit is subsumption in zijn simpelste
 *    vorm — een geordende lijst is een gedegenereerde subsumption-hiërarchie.
 *  - ALLE vurende signalen worden bewaard, niet alleen de winnende. Anders zie je in de
 *    logs geen "maskering" (signaal A vuurt altijd eerst, B wordt nooit zichtbaar).
 *  - GEEN voting/consensus-machinerie. YAD's signalen vuren één-voor-één op verschillende
 *    lus-fases; ze concurreren niet om dezelfde beslissing. Voting zou een probleem
 *    oplossen dat we niet hebben. Als soft-accumulatie ooit nodig is, komt die hier —
 *    getest — bij, niet als speculatieve laag nu.
 */

/** De acht stuck-signalen. Zelfde union als StuckReason["why"] in loop.ts (bewust: één vocabulaire). */
export type SignalId =
  | "consecutive-act-failures" // browser weigert acties (DOM-drift/modal/captcha)
  | "state-loop"               // dezelfde browserstate keert terug na andere acties
  | "url-regression"           // agent keert terug naar al-bezochte URL (afdwaling)
  | "silent-no-effect"         // muterende actie slaagt (ok=true) maar verandert niets
  | "repeat"                   // exact dezelfde actie herhaald
  | "no-progress"              // geen judge-match in 6+ LLM-aanroepen
  | "goal-drift"               // agent blijft op zelfde URL, judge ziet geen doelvoortgang
  | "consecutive-unknowns";    // judge kan uitkomst herhaaldelijk niet beoordelen

export type SignalSeverity = "hard" | "soft";

/**
 * Ernst per signaal.
 *  HARD = de omgeving is stuk of de agent is aantoonbaar vast; doorgaan is zinloos.
 *         Eén is genoeg om in te grijpen — geen drempel, geen tweede stem.
 *  SOFT = ruisig voortgangs-/twijfelsignaal; individueel zwak. (Vuurt nu nog op zijn
 *         eigen teller-drempel; toekomstige accumulatie tussen soft-signalen komt hier.)
 */
export const SIGNAL_SEVERITY: Record<SignalId, SignalSeverity> = {
  "consecutive-act-failures": "hard",
  "state-loop": "hard",
  "url-regression": "hard",
  "silent-no-effect": "hard",
  "repeat": "hard",
  "no-progress": "soft",
  "goal-drift": "soft",
  "consecutive-unknowns": "soft",
};

/**
 * Rangorde binnen dezelfde ernst (lagere index = hogere prioriteit). Bepaalt welk
 * signaal "primary" wordt als er ooit meerdere tegelijk vuren — de primary levert de
 * why/berichten voor de escalatie. Volgorde: eerst de meest objectieve/onherstelbare.
 */
const PRIORITY: readonly SignalId[] = [
  "consecutive-act-failures", // omgeving stuk — meest objectief
  "silent-no-effect",         // acties hebben aantoonbaar geen effect
  "state-loop",               // aantoonbaar in een lus
  "url-regression",           // aantoonbaar achteruit
  "repeat",                   // exacte herhaling
  "no-progress",              // zacht: geen voortgang
  "goal-drift",               // zacht: judge ziet afdwaling
  "consecutive-unknowns",     // zacht: aanhoudende twijfel
];

export interface Signal {
  id: SignalId;
  severity: SignalSeverity;
  /** Eén zin: waarom dit signaal vuurde (met de concrete teller/bewijs). Gaat de log in. */
  evidence: string;
}

/** Bouwt een Signal; severity volgt deterministisch uit de id (geen kans op mismatch). */
export function makeSignal(id: SignalId, evidence: string): Signal {
  return { id, severity: SIGNAL_SEVERITY[id], evidence };
}

export interface RankedSignals {
  /** Het signaal dat de escalatie stuurt (hoogste prioriteit onder de vurende), of null. */
  primary: Signal | null;
  /** Alle vurende signalen, gesorteerd (hard vóór soft, dan op PRIORITY). Voor de log. */
  fired: Signal[];
}

/**
 * Rangschikt de vurende signalen. Puur: geen I/O, geen state-mutatie, deterministisch.
 *  - Lege invoer → { primary: null, fired: [] } (de saaie, kritieke "geen signaal"-case).
 *  - Anders: sorteer hard-vóór-soft, dan op PRIORITY-index; primary = de eerste.
 * Onbekende id's (defensief) belanden achteraan maar gaan niet verloren.
 */
export function rankFired(signals: Signal[]): RankedSignals {
  if (signals.length === 0) return { primary: null, fired: [] };
  const rank = (s: Signal): number => {
    const sev = s.severity === "hard" ? 0 : 1000;
    const idx = PRIORITY.indexOf(s.id);
    return sev + (idx === -1 ? 999 : idx);
  };
  const fired = [...signals].sort((a, b) => rank(a) - rank(b));
  return { primary: fired[0] ?? null, fired };
}
