/**
 * RunState — de ÉNE actieve run die deze desktop-app tegelijk uitvoert.
 *
 * v1 = single-run (geen wachtrij zoals packages/dashboard/src/job-store.ts —
 * dat is een ander product voor een ander gebruik: meerdere taken parallel
 * volgen. Dit is het persoonlijke bureaublad-programma, één taak per keer is
 * hier een bewuste keuze, geen beperking die later "gewoon" verdwijnt).
 *
 * In-memory, één proces, geen persistente opslag — precies zoals een lokaal
 * bedienpaneel dat maar één taak tegelijk draait nodig heeft.
 */
import type { Action, RunStatus } from "@yad/shared";

export type DesktopRunStatus = "idle" | "running" | "done" | "error";

export interface LiveStep {
  status: RunStatus;
  step?: number;
  message: string;
  action?: Action;
  ts: number;
}

export interface RunResult {
  status: string;
  steps: number;
  summary: string | null;
  stuckSignal: string | null;
}

export interface RunSnapshot {
  status: DesktopRunStatus;
  goal: string;
  steps: LiveStep[];
  result?: RunResult;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

// Defensieve bovengrens op het aantal onthouden live-stappen. Eén run blijft
// hier ver onder (maxActions <= 100, en elke actie geeft hoogstens een paar
// update()-aanroepen), maar een afwijkend geval mag het geheugen van dit
// langlevende proces nooit onbegrensd laten groeien.
const MAX_STEPS = 4000;

export class RunState {
  private _status: DesktopRunStatus = "idle";
  private _goal = "";
  private _steps: LiveStep[] = [];
  private _result: RunResult | undefined;
  private _error: string | undefined;
  private _startedAt: number | undefined;
  private _finishedAt: number | undefined;

  // Reservering vóór een run officieel start() wordt aangeroepen. main.ts's
  // POST /run-handler moet de run-slot synchroon claimen vlak na de
  // isActive-check en VÓÓR zijn eerste await (body lezen) — anders kunnen
  // twee snel-na-elkaar binnenkomende requests allebei isActive===false zien
  // en allebei doorlopen naar start() (TOCTOU-race, zie main.ts). claim()
  // dekt precies dat venster af; release() maakt hem weer vrij als de
  // aanvraag daarna alsnog wordt afgewezen (bv. ongeldige JSON/goal).
  private _claimed = false;

  // Door de idle-wachter in main.ts gezet wanneer de UI stopt met pollen
  // terwijl er een run loopt (venster lijkt gesloten) — AgentLoop checkt dit
  // via isAborted() in runner.ts en stopt de run netjes i.p.v. onbeheerd door
  // te lopen. Reset bij elke nieuwe start().
  private _abortRequested = false;

  /** true zolang er een run bezig is (of net geclaimd) — main.ts gebruikt dit voor de 409-poort op POST /run. */
  get isActive(): boolean {
    return this._status === "running" || this._claimed;
  }

  /** Reserveer de run-slot synchroon, vóór enige await in de aanroeper. Moet gevolgd worden door start() of release(). */
  claim(): void {
    this._claimed = true;
  }

  /** Maak een claim() weer vrij zonder dat er een run is gestart (bv. de aanvraag bleek ongeldig). */
  release(): void {
    this._claimed = false;
  }

  get abortRequested(): boolean {
    return this._abortRequested;
  }

  /** Signaleer de lopende run dat hij moet stoppen (bv. UI-venster lijkt gesloten). Idempotent. */
  requestAbort(): void {
    this._abortRequested = true;
  }

  start(goal: string): void {
    this._claimed = false;
    this._abortRequested = false;
    this._status = "running";
    this._goal = goal;
    this._steps = [];
    this._result = undefined;
    this._error = undefined;
    this._startedAt = Date.now();
    this._finishedAt = undefined;
  }

  pushStep(u: { status: RunStatus; step?: number; message: string; action?: Action }): void {
    this._steps.push({ ...u, ts: Date.now() });
    if (this._steps.length > MAX_STEPS) this._steps.shift();
  }

  markDone(result: RunResult): void {
    this._status = "done";
    this._result = result;
    this._finishedAt = Date.now();
  }

  markError(error: string): void {
    this._status = "error";
    this._error = error;
    this._finishedAt = Date.now();
  }

  snapshot(): RunSnapshot {
    return {
      status: this._status,
      goal: this._goal,
      steps: this._steps,
      result: this._result,
      error: this._error,
      startedAt: this._startedAt,
      finishedAt: this._finishedAt,
    };
  }
}
