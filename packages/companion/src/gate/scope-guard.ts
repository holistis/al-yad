/**
 * ScopeGuard — de harde muur tussen Claude en de buitenwereld.
 *
 * Wraps elke HandBridge en inspecteert ELKE actie vóór uitvoering:
 *   - navigate naar een domein buiten de Assignment → STOP, log, verlaat run
 *   - navigate naar een verboden pad (/payment, /checkout, ...) → STOP
 *   - actie (click/type/etc.) op een ref uit een cross-origin iframe buiten de
 *     Assignment (bekend via SnapshotNode.frameUrl, indien de Hand dat meegeeft) → STOP
 *   - action-teller overschreden → STOP
 *
 * Het is NIET mogelijk deze guard te omzeilen: hij zit tussen het Brein en de
 * Hand. Ook als het model een andere URL probeert, passeert hij door hier.
 *
 * Gebruik samen met `isAborted: () => guard.violated` in LoopOptions zodat de
 * run bij de volgende stap netjes stopt.
 */
import type { Action, ActResult, RunStatus, Snapshot } from "@yad/shared";
import type { HandBridge } from "../agent/loop.js";
import { isUrlInAssignment, type Assignment } from "./assignment.js";
import { pathIsDenied } from "./guardrails.js";

export interface ScopeViolation {
  action: Action;
  reason: string;
  url?: string;
  timestamp: number;
}

/** Alle ref-achtige velden op een Action, ongeacht kind — voor de frame-scope-check
 *  hieronder. Los gehouden van de Action-definitie zelf (die hoort bij @yad/shared,
 *  niet bij deze guard). */
function refsOf(action: Action): string[] {
  const refs: string[] = [];
  if ("ref" in action && typeof action.ref === "string") refs.push(action.ref);
  if ("toRef" in action && typeof action.toRef === "string") refs.push(action.toRef);
  return refs;
}

export class ScopeGuard implements HandBridge {
  /** Wordt true bij de eerste scope-overtreding. Gebruik als isAborted-callback. */
  public violated = false;
  public violationDetail = "";
  public readonly violations: ScopeViolation[] = [];

  private actionCount = 0;
  /** ref → frame-URL uit de MEEST RECENTE snapshot. Nodig omdat frame-bewuste Hands
   *  (PlaywrightHand) elementen uit cross-origin iframes kunnen teruggeven; zonder deze
   *  cache zou een click/type/etc. op zo'n ref hieronder ongecontroleerd doorglippen,
   *  want de bestaande domein-check hierboven keek alleen naar `navigate`-acties
   *  (2026-09-15-audit: het echte gat zat in élke ref-actie, niet alleen navigate). */
  private lastFrameUrlByRef = new Map<string, string>();

  constructor(
    private readonly inner: HandBridge,
    private readonly assignment: Assignment,
    private readonly log: (m: string) => void = console.error,
  ) {}

  async requestSnapshot(): Promise<Snapshot> {
    const snap = await this.inner.requestSnapshot();
    this.lastFrameUrlByRef.clear();
    for (const n of snap.nodes) {
      if (n.frameUrl) this.lastFrameUrlByRef.set(n.ref, n.frameUrl);
    }
    return snap;
  }

  requestScreenshot(): Promise<string | null> {
    return this.inner.requestScreenshot();
  }

  async act(action: Action): Promise<ActResult> {
    this.actionCount++;

    // Hard cap: beschermt tegen eindeloze agent-lussen.
    if (this.actionCount > this.assignment.maxActions) {
      return this.block(action, `Actie-limiet bereikt (${this.assignment.maxActions} acties). Toewijzing beëindigd.`);
    }

    if (action.kind === "navigate") {
      // Globale verboden paden (betalen, checkout, etc.) — altijd geblokkeerd.
      if (pathIsDenied(action.url)) {
        return this.block(action, `Verboden pad: ${action.url}`);
      }
      // Domein-scope: mag de agent hier naartoe?
      if (!isUrlInAssignment(action.url, this.assignment)) {
        return this.block(
          action,
          `URL buiten toewijzingsscope: "${action.url}" — toegestane domeinen: ${this.assignment.targetDomains.join(", ")}`,
        );
      }
    }

    // Frame-scope: een ref kan uit een cross-origin iframe komen (advertentie,
    // gecompromitteerde widget, phishing-overlay) — onbekend bij de Hand ten tijde van
    // navigate(), dus apart getoetst. Ontbreekt de frame-URL (niet-frame-bewuste Hand,
    // of de ref komt niet uit de laatst bekende snapshot): geen check, bestaand gedrag.
    for (const ref of refsOf(action)) {
      const frameUrl = this.lastFrameUrlByRef.get(ref);
      if (frameUrl && pathIsDenied(frameUrl)) {
        return this.block(action, `Actie op element in verboden pad: ${frameUrl}`);
      }
      if (frameUrl && !isUrlInAssignment(frameUrl, this.assignment)) {
        return this.block(
          action,
          `Actie op element buiten toewijzingsscope (frame: "${frameUrl}") — toegestane domeinen: ${this.assignment.targetDomains.join(", ")}`,
        );
      }
    }

    return this.inner.act(action);
  }

  async requestConfirm(action: Action, reason: string): Promise<boolean> {
    return this.inner.requestConfirm(action, reason);
  }

  update(u: { status: RunStatus; step?: number; message: string; action?: Action }): void {
    this.inner.update(u);
  }

  private block(action: Action, reason: string): ActResult {
    this.violated = true;
    this.violationDetail = reason;
    const violation: ScopeViolation = {
      action,
      reason,
      url: action.kind === "navigate" ? action.url : undefined,
      timestamp: Date.now(),
    };
    this.violations.push(violation);
    this.log(`\n🛑 SCOPE GUARD — RUN GESTOPT\n   Toewijzing : ${this.assignment.id}\n   Reden      : ${reason}\n   Actie      : ${JSON.stringify(action)}\n`);
    return { ok: false, detail: `SCOPE_VIOLATION: ${reason}` };
  }
}
