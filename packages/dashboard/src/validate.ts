// Validatie van inkomende job-velden. De goal-check is bewust een letterlijke kopie
// van de check in packages/companion/src/main-server.ts zodat een goal die hier
// wordt geweigerd nooit alsnog bij main-server.ts binnenkomt (en andersom: wat hier
// doorkomt, komt daar ook nooit onverwacht op het injectie-patroon vast te lopen).

const MAX_GOAL_LENGTH = 1000;
const INJECTION_PATTERN =
  /ignore\s+(previous|all)\s+instructions?|system\s*prompt|reveal\s+(your\s+)?prompt|exfiltrat/i;

export type ValidationResult =
  | { ok: true; goal: string }
  | { ok: false; detail: string };

export function validateGoal(raw: unknown): ValidationResult {
  if (typeof raw !== "string") {
    return { ok: false, detail: "Veld 'goal' is verplicht en moet een string zijn" };
  }
  const goal = raw.slice(0, MAX_GOAL_LENGTH).trim();
  if (!goal) {
    return { ok: false, detail: "Veld 'goal' is verplicht en mag niet leeg zijn" };
  }
  if (INJECTION_PATTERN.test(goal)) {
    return { ok: false, detail: "Goal bevat een niet-toegestaan patroon" };
  }
  return { ok: true, goal };
}

// url/domains/maxSteps zijn optioneel: main-server.ts valideert ze zelf nogmaals
// (en leidt domains af uit url indien nodig), hier hoeven we alleen het type te
// bewaken zodat er geen rommel de job-store in komt.
export function coerceOptionalUrl(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

export function coerceOptionalDomains(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const domains = raw.filter((d): d is string => typeof d === "string" && d.trim().length > 0);
  return domains.length > 0 ? domains : undefined;
}

export function coerceOptionalMaxSteps(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

// main-server.ts staat zelf max. 10 gelijktijdige runs toe (MAX_CONCURRENT), als
// GLOBALE teller gedeeld door alle afnemers van die server (niet per afnemer).
// De dashboard-concurrency wordt STRIKT ONDER dat cijfer geklemd (nooit gelijk
// eraan) zodat de dashboard alleen al nooit de volledige budget van andere
// afnemers van diezelfde server kan opsouperen.
const MAIN_SERVER_MAX_CONCURRENT = 10;
const DASHBOARD_MAX_CONCURRENCY = MAIN_SERVER_MAX_CONCURRENT - 1;

export function clampConcurrency(raw: number): number {
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(Math.floor(raw), DASHBOARD_MAX_CONCURRENCY);
}
