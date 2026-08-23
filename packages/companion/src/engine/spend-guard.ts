import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LlmError } from "./errors.js";

export interface SpendLedger {
  date: string; // YYYY-MM-DD
  requests: number;
  promptTokens: number;
  completionTokens: number;
}

export interface SpendCall {
  at: string; // ISO
  provider: string;
  promptTokens: number;
  completionTokens: number;
}

export interface SpendSnapshot {
  killed: boolean;
  maxRequestsPerDay: number;
  today: SpendLedger;
  recent: SpendCall[];
}

const DEFAULT_MAX_PER_DAY = 1000;
const RECENT_KEEP = 50;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Uitgaven-poort. Telt geslaagde AI-aanroepen (en tokens) per dag, dwingt een
 * dag-limiet af, en biedt een noodstop. Zo kan een zelfstandige agent nooit
 * stilletjes ongelimiteerd de eigen sleutel van de gebruiker leegtrekken, en de
 * gebruiker kan alles in één klik stilleggen. Persisteert naar spend-ledger.json
 * in de data-map van de companion.
 */
export class SpendGuard {
  private readonly dataDir?: string;
  private readonly file?: string;
  private readonly log: (m: string) => void;
  private killed = false;
  private maxRequestsPerDay: number;
  private ledger: SpendLedger;
  private recent: SpendCall[] = [];

  constructor(opts: { dataDir?: string; maxRequestsPerDay?: number; log?: (m: string) => void } = {}) {
    this.dataDir = opts.dataDir;
    this.file = opts.dataDir ? join(opts.dataDir, "spend-ledger.json") : undefined;
    this.log = opts.log ?? ((): void => {});
    this.maxRequestsPerDay = opts.maxRequestsPerDay ?? DEFAULT_MAX_PER_DAY;
    this.ledger = this.load();
  }

  private load(): SpendLedger {
    const fresh: SpendLedger = { date: todayStr(), requests: 0, promptTokens: 0, completionTokens: 0 };
    if (!this.file) return fresh;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as {
        ledger?: SpendLedger;
        recent?: SpendCall[];
        maxRequestsPerDay?: number;
      };
      if (typeof raw.maxRequestsPerDay === "number") this.maxRequestsPerDay = raw.maxRequestsPerDay;
      if (Array.isArray(raw.recent)) this.recent = raw.recent.slice(-RECENT_KEEP);
      if (raw.ledger && raw.ledger.date === todayStr()) return raw.ledger;
    } catch {
      /* geen of kapot bestand: verse ledger */
    }
    return fresh;
  }

  private save(): void {
    if (!this.file || !this.dataDir) return;
    try {
      mkdirSync(this.dataDir, { recursive: true });
      writeFileSync(
        this.file,
        JSON.stringify({ ledger: this.ledger, recent: this.recent, maxRequestsPerDay: this.maxRequestsPerDay }),
      );
    } catch (e) {
      this.log(`spend-ledger opslaan faalde: ${(e as Error).message}`);
    }
  }

  private rollIfNewDay(): void {
    const d = todayStr();
    if (this.ledger.date !== d) {
      this.ledger = { date: d, requests: 0, promptTokens: 0, completionTokens: 0 };
    }
  }

  /** Gooit als de noodstop aan staat of de dag-limiet bereikt is. Roep vóór elke AI-aanroep. */
  checkBefore(): void {
    if (this.killed) {
      throw new LlmError("Yad is gestopt met de noodstop. Zet hem weer aan in de instellingen.", {
        retryable: false,
      });
    }
    this.rollIfNewDay();
    if (this.ledger.requests >= this.maxRequestsPerDay) {
      throw new LlmError(
        `Dag-limiet bereikt (${this.maxRequestsPerDay} AI-aanroepen). Verhoog hem in de instellingen of wacht tot morgen.`,
        { retryable: false },
      );
    }
  }

  /** Boekt een geslaagde aanroep (telt mee voor de dag-limiet). */
  record(provider: string, usage?: { promptTokens?: number; completionTokens?: number }): void {
    this.rollIfNewDay();
    const pt = usage?.promptTokens ?? 0;
    const ct = usage?.completionTokens ?? 0;
    this.ledger.requests += 1;
    this.ledger.promptTokens += pt;
    this.ledger.completionTokens += ct;
    this.recent.push({ at: new Date().toISOString(), provider, promptTokens: pt, completionTokens: ct });
    if (this.recent.length > RECENT_KEEP) this.recent = this.recent.slice(-RECENT_KEEP);
    this.save();
  }

  setKilled(killed: boolean): void {
    this.killed = killed;
    this.log(`noodstop ${killed ? "AAN" : "uit"}`);
    this.save();
  }

  isKilled(): boolean {
    return this.killed;
  }

  setMaxRequestsPerDay(n: number): void {
    if (Number.isFinite(n) && n > 0) {
      this.maxRequestsPerDay = Math.floor(n);
      this.save();
    }
  }

  snapshot(): SpendSnapshot {
    this.rollIfNewDay();
    return {
      killed: this.killed,
      maxRequestsPerDay: this.maxRequestsPerDay,
      today: { ...this.ledger },
      recent: [...this.recent],
    };
  }
}
