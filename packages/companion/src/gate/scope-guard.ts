/**
 * ScopeGuard — de harde muur tussen Claude en de buitenwereld.
 *
 * Wraps elke HandBridge en inspecteert ELKE actie vóór uitvoering:
 *   - navigate naar een domein buiten de Assignment → STOP, log, verlaat run
 *   - navigate naar een verboden pad (/payment, /checkout, ...) → STOP
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

export class ScopeGuard implements HandBridge {
  /** Wordt true bij de eerste scope-overtreding. Gebruik als isAborted-callback. */
  public violated = false;
  public violationDetail = "";
  public readonly violations: ScopeViolation[] = [];

  private actionCount = 0;

  constructor(
    private readonly inner: HandBridge,
    private readonly assignment: Assignment,
    private readonly log: (m: string) => void = console.error,
  ) {}

  async requestSnapshot(): Promise<Snapshot> {
    return this.inner.requestSnapshot();
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
