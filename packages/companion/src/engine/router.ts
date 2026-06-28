import type { ChatRequest, ChatResponse, LlmProvider } from "./types.js";
import { LlmError } from "./errors.js";
import { CircuitBreaker } from "./circuit-breaker.js";

export interface RouterOptions {
  breaker?: CircuitBreaker;
  /** extra pogingen per provider bij een retryable fout (bovenop de eerste) */
  retriesPerProvider?: number;
  /** injecteerbaar voor tests (geen echte wachttijd) */
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export interface RouteResult extends ChatResponse {
  /** welke providers werden geprobeerd voordat deze slaagde */
  attempts: string[];
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Geordende pool met automatische doorschakeling. Probeert providers op tier-volgorde;
 * een open circuit (dode provider) wordt overgeslagen; retryable fouten (429/5xx/netwerk)
 * krijgen een paar pogingen met exponentiele backoff voordat hij doorschakelt.
 * Ollama hoort als laatste in de lijst als bodemloze terugval.
 */
export class LlmRouter {
  private readonly providers: LlmProvider[];
  private readonly breaker: CircuitBreaker;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;

  constructor(providers: LlmProvider[], opts: RouterOptions = {}) {
    // sorteer op tier (laag eerst), stabiel
    this.providers = [...providers].sort((a, b) => a.tier - b.tier);
    this.breaker = opts.breaker ?? new CircuitBreaker();
    this.retries = opts.retriesPerProvider ?? 1;
    this.sleep = opts.sleep ?? defaultSleep;
    this.log = opts.log ?? (() => {});
  }

  get size(): number {
    return this.providers.length;
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<RouteResult> {
    const attempts: string[] = [];
    const errors: string[] = [];

    for (const p of this.providers) {
      if (this.breaker.isOpen(p.name)) {
        this.log(`skip ${p.name} (circuit open)`);
        continue;
      }
      attempts.push(p.name);

      for (let attempt = 0; attempt <= this.retries; attempt++) {
        try {
          const res = await p.chat(req, signal);
          this.breaker.recordSuccess(p.name);
          return { ...res, attempts };
        } catch (err) {
          const e = err instanceof LlmError ? err : new LlmError(String(err), { retryable: false });
          if (e.retryable && attempt < this.retries) {
            const backoff = Math.min(5_000, 250 * 2 ** attempt) + Math.floor((attempt + 1) * 50);
            this.log(`${p.name} faalde (${e.message}); retry in ${backoff}ms`);
            await this.sleep(backoff);
            continue;
          }
          this.breaker.recordFailure(p.name);
          errors.push(`${p.name}: ${e.message}`);
          this.log(`${p.name} opgegeven, door naar volgende`);
          break;
        }
      }
    }

    throw new LlmError(
      `Alle providers faalden of zijn open. Geprobeerd: [${attempts.join(", ")}]. ` +
        `Fouten: ${errors.join(" | ") || "geen beschikbare providers"}`,
      { retryable: false },
    );
  }

  /** Momentopname van de gezondheid per provider (voor het dashboard later). */
  health(): Array<{ name: string; tier: number; open: boolean; score: number }> {
    return this.providers.map((p) => ({
      name: p.name,
      tier: p.tier,
      open: this.breaker.isOpen(p.name),
      score: this.breaker.healthScore(p.name),
    }));
  }
}
