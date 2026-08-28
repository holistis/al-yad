// Worker-pool: haalt queued jobs uit de JobStore en voert ze één voor één per
// worker uit tegen main-server.ts (POST /goal, blokkerend tot de run klaar is).
// main-server.ts heeft zelf geen job-tracking — dat is precies waarom dit bestaat.

import type { JobStore } from "./job-store.js";
import type { JobResult } from "./types.js";

export interface WorkerPoolOptions {
  yadServerUrl: string;
  concurrency: number;
  // Harde ceiling op hoe lang we op één /goal-call wachten. main-server.ts zelf
  // heeft geen wall-clock-limiet op een run (alleen per-stap timeouts), dus
  // zonder dit zou een hangende fetch() de worker-slot voor altijd bezet
  // houden en, bij `concurrency` keer, de hele pool stil laten vallen. Bij
  // afloop wordt de job als error gemarkeerd — main-server.ts's eigen run kan
  // daarna nog even doorlopen (er is geen cancel-endpoint), maar de dashboard
  // geeft de worker-slot en de gebruiker in elk geval terug.
  timeoutMs: number;
  log: (msg: string) => void;
}

// Losse vorm van de /goal-response uit main-server.ts; alles optioneel omdat we
// het antwoord van een extern proces nooit blindelings vertrouwen.
interface GoalResponse {
  ok?: boolean;
  status?: string;
  steps?: number;
  summary?: string | null;
  stuckSignal?: string | null;
  detail?: string;
}

function isGoalResponse(value: unknown): value is GoalResponse {
  return typeof value === "object" && value !== null;
}

export class WorkerPool {
  private active = 0;
  private pumping = false;

  constructor(
    private readonly store: JobStore,
    private readonly opts: WorkerPoolOptions,
  ) {}

  get activeRunners(): number {
    return this.active;
  }

  get concurrency(): number {
    return this.opts.concurrency;
  }

  get queueLength(): number {
    return this.store.queuedIds().length;
  }

  // Oproepen na elke nieuwe job. Pakt zoveel queued jobs op als er ruimte is
  // onder de concurrency-cap; herhaalt zichzelf zodra een worker vrijkomt.
  pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.active < this.opts.concurrency) {
        const nextId = this.store.queuedIds().at(0);
        if (nextId === undefined) break;
        this.active++;
        this.store.markRunning(nextId);
        void this.runJob(nextId).finally(() => {
          this.active--;
          this.pump();
        });
      }
    } finally {
      this.pumping = false;
    }
  }

  private async runJob(id: string): Promise<void> {
    const job = this.store.get(id);
    if (!job) return; // weggesnoeid vóór hij aan de beurt kwam

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs);

    try {
      const res = await fetch(`${this.opts.yadServerUrl}/goal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: job.goal,
          url: job.url,
          domains: job.domains,
          maxSteps: job.maxSteps,
        }),
        signal: ctrl.signal,
      });

      let data: GoalResponse | null = null;
      let bodyParseFailed = false;
      try {
        const parsed: unknown = await res.json();
        if (isGoalResponse(parsed)) data = parsed;
      } catch {
        bodyParseFailed = true;
      }

      if (!res.ok || !data || data.ok === false) {
        const detail =
          data?.detail ??
          (bodyParseFailed
            ? `yad-server antwoordde met status ${res.status}, maar de respons was geen geldige JSON`
            : `yad-server antwoordde met status ${res.status}`);
        this.store.markError(id, detail);
        this.opts.log(`Job ${id} mislukt: ${detail}`);
        return;
      }

      const result: JobResult = {
        status: data.status ?? "unknown",
        steps: data.steps ?? 0,
        summary: data.summary ?? null,
        stuckSignal: data.stuckSignal ?? null,
      };
      this.store.markDone(id, result);
      this.opts.log(`Job ${id} klaar (${result.status}, ${result.steps} stappen)`);
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "AbortError";
      const detail = timedOut
        ? `yad-server antwoordde niet binnen ${this.opts.timeoutMs}ms — job afgebroken (mogelijk draait de run op main-server.ts nog door)`
        : e instanceof Error
          ? e.message
          : String(e);
      this.store.markError(id, detail);
      this.opts.log(`Job ${id} fout: ${detail}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
