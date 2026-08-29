/**
 * Per-provider circuit-breaker tegen de dode-autopilot-bug: een provider die
 * blijft falen (bv. verlopen key) wordt tijdelijk overgeslagen, zodat een dode
 * sleutel nooit de hele machine stillegt. Herstelt vanzelf na de cooldown.
 *
 * `now` is injecteerbaar zodat tests deterministisch zijn (geen echte klok).
 */
export interface BreakerOptions {
  /** aantal opeenvolgende fouten voor de breaker opent */
  threshold?: number;
  /** hoe lang open blijft (ms) */
  cooldownMs?: number;
  now?: () => number;
}

interface ProviderState {
  fails: number;
  openUntil: number;
  health: number; // 0..100
  /** aantal keer consecutief geopend zonder tussentijds succes; drijft de cooldown op */
  openStreak: number;
}

/** cooldown-vermenigvuldiger per herhaalde opening: 1x, 2x, dan 4x (plafond) */
const MAX_COOLDOWN_MULTIPLIER_EXP = 2;

export class CircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly state = new Map<string, ProviderState>();

  constructor(opts: BreakerOptions = {}) {
    this.threshold = opts.threshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 5 * 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  private get(name: string): ProviderState {
    let s = this.state.get(name);
    if (!s) {
      s = { fails: 0, openUntil: 0, health: 100, openStreak: 0 };
      this.state.set(name, s);
    }
    return s;
  }

  /** Open = tijdelijk overslaan. */
  isOpen(name: string): boolean {
    return this.now() < this.get(name).openUntil;
  }

  recordSuccess(name: string): void {
    const s = this.get(name);
    s.fails = 0;
    s.openUntil = 0;
    s.openStreak = 0;
    s.health = Math.min(100, s.health + 20);
  }

  /**
   * Elke keer dat de breaker weer opent zonder dat er tussentijds een succes
   * was, verdubbelt de cooldown (tot een plafond). Dit onderscheidt een korte
   * hapering (1 open, normale cooldown) van een aanhoudende storing (herhaald
   * open, steeds langere cooldown) — zonder dit bleef een dode provider elke
   * paar minuten opnieuw geprobeerd worden terwijl de hele pool al minutenlang
   * plat lag (gezien tijdens de solo-benchmark van 2026-08-28: ~25 min lang
   * niets dan rate-limit-fouten over de volledige pool).
   */
  recordFailure(name: string): void {
    const s = this.get(name);
    s.fails += 1;
    s.health = Math.max(0, s.health - 34);
    if (s.fails >= this.threshold) {
      s.openStreak += 1;
      const multiplier = 2 ** Math.min(s.openStreak - 1, MAX_COOLDOWN_MULTIPLIER_EXP);
      s.openUntil = this.now() + this.cooldownMs * multiplier;
      s.fails = 0; // reset na openen; na cooldown krijgt de provider een nieuwe kans (half-open)
    }
  }

  healthScore(name: string): number {
    return this.get(name).health;
  }
}
