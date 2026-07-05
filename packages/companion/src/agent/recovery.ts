import type { ChatLike, StuckReason } from "./loop.js";
import type { HistoryItem } from "./prompt.js";

const ADVICE: Record<string, string> = {
  "goal-drift":
    "Probeer een andere aanpak: gebruik extract ZONDER ref om de volledige pagina te lezen, of navigeer direct naar een sub-URL die dichter bij het doel ligt.",
  "consecutive-act-failures":
    "Browser weigert acties. Gebruik scroll gevolgd door extract ZONDER ref om de huidige staat te lezen, dan opnieuw een selector kiezen.",
  "url-regression":
    "Navigeer direct naar de exacte doel-URL. Gebruik de browser niet om terug te gaan.",
  "no-progress":
    "Gebruik extract ZONDER ref om de volledige pagina te lezen en daarna een nieuwe aanpak te kiezen.",
  "repeat":
    "Stop met de herhaalde actie. Gebruik extract ZONDER ref om te zien wat er werkelijk op de pagina staat.",
  "state-loop":
    "Ververs de pagina via navigate naar dezelfde URL, of navigeer direct naar een diepere pagina-URL.",
  "silent-no-effect":
    "Gebruik extract ZONDER ref om de werkelijke pagina-staat te lezen en een andere selector te kiezen.",
  "consecutive-unknowns":
    "Gebruik extract ZONDER ref om de pagina volledig te lezen zodat de agent beter kan beslissen.",
  "parse-fail":
    "Gebruik extract ZONDER ref om meer context te krijgen en stuur daarna een korter, eenvoudiger plan.",
};

/**
 * Roept een LLM aan om een concreet herstelplan te genereren voor een vastgelopen agent.
 * Geeft null terug als de LLM faalt of geen bruikbaar plan produceert.
 *
 * Dit is de gedeelde kern van het zelfherstellende leer-systeem: zowel de live sessie
 * (session.ts) als de benchmark-harness (scripts/benchmark.ts) roepen dit aan.
 */
export async function generateRecoveryHint(
  router: ChatLike,
  reason: StuckReason,
): Promise<string | null> {
  const recentActions = (reason.history as HistoryItem[])
    .slice(-5)
    .map((h) => {
      const act = JSON.stringify(h.action);
      const out = h.ok ? "ok" : `MISLUKT: ${h.detail ?? "?"}`;
      return `  ${act} → ${out}`;
    })
    .join("\n");

  const advice = ADVICE[reason.why] ?? "Gebruik extract ZONDER ref om de pagina-staat te lezen en een andere aanpak te kiezen.";

  const userPrompt = `Browse-agent vastzit.
DOEL: ${reason.goal.slice(0, 200)}
HUIDIGE URL: ${reason.url}
REDEN VASTZIT: ${reason.why}
RECENTE ACTIES:
${recentActions || "  (geen acties geregistreerd)"}

STANDAARD AANPAK VOOR DEZE REDEN: ${advice}

Geef nu een specifiek herstelplan: welke actie uitvoeren, welk element of URL. Max 2 zinnen. Geen uitleg, geen inleiding.`;

  try {
    const resp = await router.chat({
      messages: [
        {
          role: "system",
          content:
            "Je bent een browse-agent herstel-specialist. Geef ALLEEN een concreet herstelplan in maximaal 2 zinnen. Geen inleiding.",
        },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      maxTokens: 200,
    });
    const hint = (resp.content ?? "").trim();
    if (hint.length < 10) return null;
    return hint;
  } catch {
    return null;
  }
}
