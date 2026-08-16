import { describe, it, expect } from "vitest";
import { buildPool } from "./pool.js";

/**
 * Tests voor de lokale stand: niets van de pagina verlaat de machine.
 *
 * Dit is geen gewone functietest maar de toetsing van een BELOFTE. YAD stuurt normaal de
 * volledige URL, 1500 tekens paginatekst, de opdracht van de gebruiker en soms een
 * schermafbeelding naar het model. Staat de lokale stand aan, dan mag daar geen enkele
 * cloudprovider meer in de pool zitten, ook niet als terugval.
 *
 * Waarom uitsluiten en niet achteraan zetten: een terugval betekent dat de belofte breekt
 * zodra het lokale model traag is of even niet antwoordt, en dan merkt de gebruiker daar
 * niets van. Precies daarom test dit expliciet op AFWEZIGHEID, met een omgeving die
 * volgestopt is met sleutels. Zou iemand later een provider toevoegen zonder aan deze
 * stand te denken, dan valt deze test om.
 */

/** Een omgeving met sleutels voor zo ongeveer alles wat de pool kent. */
const VOL = {
  GEMINI_API_KEY: "x",
  GEMINI_API_KEY_2: "x",
  GROQ_API_KEY: "x",
  CEREBRAS_API_KEY: "x",
  OPENROUTER_API_KEY: "x",
  GITHUB_TOKEN: "x",
  TOGETHER_API_KEY: "x",
  MISTRAL_API_KEY: "x",
  HYPERBOLIC_API_KEY: "x",
  ANTHROPIC_API_KEY: "x",
  OPENAI_API_KEY: "x",
} as unknown as Parameters<typeof buildPool>[0];

describe("lokale stand", () => {
  it("laat ZONDER de stand wél cloudproviders toe (controle)", () => {
    const pool = buildPool(VOL);
    // Zonder deze controle zou de test hieronder ook slagen bij een kapotte buildPool
    // die altijd een lege lijst teruggeeft.
    expect(pool.length).toBeGreaterThan(1);
    expect(pool.some((p) => p.name !== "ollama")).toBe(true);
  });

  it("houdt met YAD_LOKAAL=1 alleen het lokale model over", () => {
    const pool = buildPool({ ...VOL, YAD_LOKAAL: "1" } as typeof VOL);
    expect(pool).toHaveLength(1);
    expect(pool[0]?.name).toBe("ollama");
    expect(pool[0]?.baseUrl).toContain("localhost:11434");
  });

  it("accepteert ook 'aan' als waarde", () => {
    const pool = buildPool({ ...VOL, YAD_LOKAAL: "aan" } as typeof VOL);
    expect(pool).toHaveLength(1);
    expect(pool[0]?.name).toBe("ollama");
  });

  it("laat GEEN ENKELE bekende cloudprovider staan", () => {
    const pool = buildPool({ ...VOL, YAD_LOKAAL: "1" } as typeof VOL);
    const cloud = ["gemini", "groq", "cerebras", "openrouter", "github-models", "together", "mistral", "hyperbolic", "paid", "custom", "ollama-external"];
    for (const naam of cloud) {
      expect(pool.some((p) => p.name.startsWith(naam))).toBe(false);
    }
  });

  it("negeert een primaire-provider-instelling die de stand zou omzeilen", () => {
    // Iemand die per ongeluk allebei zet, mag geen cloud terugkrijgen: de striktere
    // instelling hoort te winnen, anders is de belofte alsnog te omzeilen.
    const pool = buildPool({ ...VOL, YAD_LOKAAL: "1", YAD_PRIMARY_PROVIDER: "groq" } as typeof VOL);
    expect(pool).toHaveLength(1);
    expect(pool[0]?.name).toBe("ollama");
  });
});
