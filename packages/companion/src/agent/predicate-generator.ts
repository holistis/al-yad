/**
 * Predicate-generator — vraagt de LLM aan het begin van een run om 1-3
 * DONE-predicaten te genereren die objectief bewijzen dat het doel bereikt is.
 *
 * Werking:
 *  - Wordt éénmalig aangeroepen bij de start van een run als er geen substates meegegeven zijn
 *  - Maakt één LLM-aanroep met een gespecialiseerde prompt (budget: max 300 tokens)
 *  - Parseert het antwoord met de bestaande parsePredicates() — hetzelfde systeem
 *    dat de live DONE-check ook gebruikt
 *  - Retourneert Substate[] — leeg array bij fout of puur-informatieve goals
 *
 * Voordeel vs. losse done-predicaten in het model-antwoord:
 *  - De generator kijkt naar de STARTPAGINA en het doel samen
 *  - Daardoor produceert hij sterkere, meer doelbewuste predicaten (url-contains ipv text-present)
 *  - De loop-LLM-aanroepen hoeven niet meer "zelf te bedenken" hoe klaar eruitziet
 *
 * Graceful degradation: elke fout (LLM-fout, parse-fout, lege output) levert een
 * lege array → de run gaat door zonder predicaten, precies als vroeger.
 */

import type { Snapshot } from "@yad/shared";
import type { ChatRequest } from "../engine/types.js";
import { parsePredicates, PREDICATE_GRAMMAR } from "./predicate.js";
import type { Substate } from "./substate.js";

/** Minimale interface — past op LlmRouter en ChatLike zonder circulaire import. */
export interface PredicateChat {
  chat(req: ChatRequest): Promise<{ content: string }>;
}

const SYSTEM = `You are a browser automation planner that generates deterministic done-predicates.
Given a user goal and the starting page state, output ONE substate: a label and 1–3 objective predicates that deterministically prove the goal is complete.

${PREDICATE_GRAMMAR}

Output format (JSON, nothing else):
{ "label": "short description of done state", "predicates": [...] }

If the goal is PURELY INFORMATIONAL (reading/extracting text, no page state change) → output:
{ "label": null, "predicates": [] }

Rules (in priority order):
1. url-contains — ALWAYS prefer this when success changes the URL or adds a query param (STRONGEST)
2. role-present — when a specific element appears on success (heading "Thank you", button "Download")
3. role-absent  — when a modal/overlay disappears on success (dialog "Login", form "Register")
4. attribute-contains — when a combobox/select value changes but URL stays the same
5. NEVER use text-present or text-absent — they are WEAK (truncation = false indeterminate)
6. 1 strong predicate beats 3 weak ones — prefer url-contains alone over 3 role-present entries
7. Return max 3 predicates`;

export async function generatePredicates(
  router: PredicateChat,
  goal: string,
  snapshot: Snapshot,
): Promise<Substate[]> {
  const nodeLines = snapshot.nodes
    .slice(0, 10)
    .map((n) => {
      const val = n.value ? ` =${JSON.stringify(n.value.slice(0, 30))}` : "";
      return `${n.role} "${n.name.slice(0, 50)}"${val}`;
    })
    .join("\n");

  const userMsg = [
    `GOAL: ${goal}`,
    ``,
    `CURRENT URL: ${snapshot.url}`,
    ``,
    `CURRENT PAGE ELEMENTS (first 10):`,
    nodeLines || "(none)",
  ].join("\n");

  let raw: string;
  try {
    const res = await router.chat({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMsg },
      ],
      temperature: 0,
      json: true,
      maxTokens: 300,
    });
    raw = res.content;
  } catch {
    return []; // LLM-fout → graceful degradation
  }

  try {
    const obj = JSON.parse(raw) as { label?: string | null; predicates?: unknown };
    if (!obj.label || typeof obj.label !== "string") return [];
    const preds = parsePredicates(Array.isArray(obj.predicates) ? obj.predicates : []);
    if (preds.length === 0) return [];
    return [{ label: obj.label, predicates: preds }];
  } catch {
    return []; // parse-fout → graceful degradation
  }
}
