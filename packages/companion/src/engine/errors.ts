/** Fout van een LLM-provider, met genoeg info om failover/retry te sturen. */
export class LlmError extends Error {
  readonly status?: number;
  /** Mag deze provider opnieuw geprobeerd worden (zelfde call), of meteen door naar de volgende? */
  readonly retryable: boolean;

  constructor(message: string, opts: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "LlmError";
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}

/** Bepaalt uit een HTTP-status of de fout tijdelijk is (retry/cooldown waard). */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
