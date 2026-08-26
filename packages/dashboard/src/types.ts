// Gedeelde types voor de job-store en worker-pool.

export type JobStatus = "queued" | "running" | "done" | "error";

// Spiegelt de response-vorm van POST /goal op main-server.ts.
export interface JobResult {
  status: string;
  steps: number;
  summary: string | null;
  stuckSignal: string | null;
}

export interface Job {
  id: string;
  goal: string;
  url?: string;
  domains?: string[];
  maxSteps?: number;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: JobResult;
  error?: string;
}

export interface CreateJobInput {
  goal: string;
  url?: string;
  domains?: string[];
  maxSteps?: number;
}
