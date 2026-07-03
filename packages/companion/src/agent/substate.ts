/**
 * Substate-tracker — geordende checkpoint-lijst voor complexe doelen.
 *
 * Een enkel doel ("sorteer en download rapport") kan bestaan uit meerdere
 * aantoonbare substappen die elk een eigen set deterministieke predicaten
 * hebben. De tracker weet welke stap nu actief is, checkt deterministisch
 * of die stap klaar is (via evaluatePredicates — geen LLM nodig), en
 * advance naar de volgende als alle predicaten matchen.
 *
 * Integratie met de lus:
 *  - Na elke snapshot: tracker.tryAdvance(snapshot) → log bij advance
 *  - In buildMessages: tracker.toHint() → "STAP 2/3: navigeer naar account"
 *
 * Ontwerpregel: lege predicate-set = nooit advance (anders zit de tracker op
 * stap met evaluatePredicates empty → "indeterminate", niet "match").
 * Dit is bewust: een substate zonder predicaten heeft geen aantoonbaar eind.
 */

import type { Snapshot } from "@yad/shared";
import type { Predicate } from "./predicate.js";
import { evaluatePredicates } from "./predicate.js";

export interface Substate {
  /** Wat de agent in mensentaal moet bereiken op deze stap. Gaat de prompt in. */
  label: string;
  /** Deterministische predicaten die bewijzen dat deze stap klaar is. */
  predicates: Predicate[];
}

export interface SubstateProgress {
  currentIndex: number;   // 0-indexed
  totalCount: number;
  currentLabel: string;
  isComplete: boolean;
}

export class SubstateTracker {
  private idx = 0;

  constructor(private readonly substates: Substate[]) {}

  get hasSubstates(): boolean { return this.substates.length > 0; }
  get isComplete(): boolean { return this.idx >= this.substates.length; }

  get progress(): SubstateProgress | null {
    if (!this.hasSubstates) return null;
    return {
      currentIndex: this.idx,
      totalCount: this.substates.length,
      currentLabel: this.substates[this.idx]?.label ?? "afgerond",
      isComplete: this.isComplete,
    };
  }

  /**
   * Controleer of de huidige substate's predicaten matchen. Zo ja: advance.
   * Geeft true terug als er een advance was — de lus logt dit als mijlpaal.
   * Lege predicate-set → nooit advance (geen aantoonbaar eindcriterium).
   */
  tryAdvance(snapshot: Snapshot): boolean {
    if (this.isComplete) return false;
    const current = this.substates[this.idx];
    if (!current || current.predicates.length === 0) return false;
    const result = evaluatePredicates(current.predicates, snapshot);
    if (result.verdict === "match") {
      this.idx++;
      return true;
    }
    return false;
  }

  /**
   * Prompt-hint voor het model: huidige stap als context boven RECENT ACTIONS.
   * Geeft null als er geen substates zijn (geen overhead voor eenvoudige doelen).
   */
  toHint(): string | null {
    const p = this.progress;
    if (!p) return null;
    if (p.isComplete) return `STAPPEN VOLTOOID: alle ${p.totalCount} tussenstap(pen) afgerond.`;
    return `HUIDIGE STAP ${p.currentIndex + 1}/${p.totalCount}: ${p.currentLabel}`;
  }
}
