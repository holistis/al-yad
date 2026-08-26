// In-memory job-store (geen database nodig voor v1). Eén proces, één Map.
//
// Geheugen-limiet: we bewaren maximaal MAX_JOBS taken (nieuwste blijven staan,
// oudste vallen eraf). Dit voorkomt dat een dashboard dat dagenlang openstaat
// onbeperkt groeit. prune() snoeit bij voorkeur de oudste AFGERONDE taken
// ('done'/'error') weg — die zijn veilig te verliezen (alleen geschiedenis).
// Pas als er geen afgeronde taken meer over zijn om te offeren, valt hij terug
// op de allotoudste taak ongeacht status ('queued'/'running' meegerekend), om
// de cap alsnog hard te houden. Dat laatste geval raakt get()/mark*() alsnog
// een no-op voor die taak, maar is bij MAX_JOBS=200 en een concurrency-cap van
// hoogstens 9 in de praktijk zeldzaam — een bewuste v1-afweging, geen garantie.

import { randomUUID } from "node:crypto";
import type { CreateJobInput, Job, JobResult } from "./types.js";

const MAX_JOBS = 200;

export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly order: string[] = []; // volgorde van aanmaken, oudste eerst

  create(input: CreateJobInput): Job {
    const job: Job = {
      id: randomUUID(),
      goal: input.goal,
      url: input.url,
      domains: input.domains,
      maxSteps: input.maxSteps,
      status: "queued",
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.order.push(job.id);
    this.prune();
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  // Nieuwste eerst, zodat de UI niet zelf hoeft te sorteren.
  list(): Job[] {
    const result: Job[] = [];
    for (let i = this.order.length - 1; i >= 0; i--) {
      const id = this.order.at(i);
      if (id === undefined) continue;
      const job = this.jobs.get(id);
      if (job) result.push(job);
    }
    return result;
  }

  queuedIds(): string[] {
    return this.order.filter((id) => this.jobs.get(id)?.status === "queued");
  }

  markRunning(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = "running";
    job.startedAt = Date.now();
  }

  markDone(id: string, result: JobResult): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = "done";
    job.result = result;
    job.finishedAt = Date.now();
  }

  markError(id: string, error: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = "error";
    job.error = error;
    job.finishedAt = Date.now();
  }

  private prune(): void {
    while (this.order.length > MAX_JOBS) {
      // Zoek de oudste taak die al klaar is ('done'/'error', of al weg) — die
      // offeren we eerst. Alleen als er geen enkele afgeronde taak meer in
      // order[] staat (een pathologische wachtrij van >200 'queued'/'running'
      // taken tegelijk) vallen we terug op de allereerste, ongeacht status.
      let idx = this.order.findIndex((id) => {
        const job = this.jobs.get(id);
        return job === undefined || job.status === "done" || job.status === "error";
      });
      if (idx === -1) idx = 0;
      const removed = this.order.splice(idx, 1)[0];
      if (removed !== undefined) this.jobs.delete(removed);
    }
  }
}
