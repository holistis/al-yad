/**
 * LiveHand — decorator om een HandBridge die elke voortgangs-update() ook naar
 * de RunState schrijft, zodat de UI de run kan pollen via GET /run/status.
 *
 * Zelfde delegatie-vorm als ScopeGuard (packages/companion/src/gate/scope-guard.ts):
 * elke HandBridge-methode gaat 1-op-1 door naar de binnenste hand; alleen
 * update() krijgt een extra zij-effect. Wordt gewikkeld ÓM de ScopeGuard heen
 * (guard blijft de harde muur, dit is alleen een waarnemer erbovenop).
 */
import type { Action, ActResult, RunStatus, Snapshot } from "@yad/shared";
import type { HandBridge } from "@yad/companion/dist/agent/loop.js";
import type { RunState } from "./run-state.js";

export class LiveHand implements HandBridge {
  constructor(
    private readonly inner: HandBridge,
    private readonly state: RunState,
  ) {}

  requestSnapshot(): Promise<Snapshot> {
    return this.inner.requestSnapshot();
  }

  requestScreenshot(): Promise<string | null> {
    return this.inner.requestScreenshot();
  }

  act(action: Action): Promise<ActResult> {
    return this.inner.act(action);
  }

  requestConfirm(action: Action, reason: string): Promise<boolean> {
    return this.inner.requestConfirm(action, reason);
  }

  update(u: { status: RunStatus; step?: number; message: string; action?: Action }): void {
    this.inner.update(u);
    this.state.pushStep(u);
  }
}
