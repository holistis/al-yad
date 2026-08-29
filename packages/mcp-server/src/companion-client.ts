const BASE_URL = process.env["YAD_COMPANION_URL"] ?? "http://127.0.0.1:3747";

export class CompanionError extends Error {}

async function request(path: string, opts: { method: "GET" | "POST"; body?: unknown }): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: opts.method,
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new CompanionError(
      `Could not reach the Yad companion at ${BASE_URL}. Is Yad installed and running, with Chrome open and the extension connected? (${(e as Error).message})`,
    );
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new CompanionError(`Yad companion returned a non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return data;
}

export function status(): Promise<unknown> {
  return request("/status", { method: "GET" });
}

export function navigate(url: string): Promise<unknown> {
  return request("/navigate", { method: "POST", body: { url } });
}

export function capture(): Promise<unknown> {
  return request("/capture", { method: "POST" });
}

export interface GoalOptions {
  url?: string;
  maxSteps?: number;
  autonomy?: "confirm" | "auto";
}

export function runGoal(goal: string, opts: GoalOptions = {}): Promise<unknown> {
  return request("/goal", {
    method: "POST",
    body: { goal, url: opts.url, maxSteps: opts.maxSteps, autonomy: opts.autonomy ?? "auto", sync: true },
  });
}

export function lastResult(): Promise<unknown> {
  return request("/result", { method: "GET" });
}
