// Validatie van inkomende run-velden. Letterlijke kopie van het patroon in
// packages/dashboard/src/validate.ts (dat zelf weer main-server.ts's inline
// check spiegelt), zodat een goal die hier wordt geweigerd nooit alsnog bij
// de motor (runner.ts -> companion) binnenkomt.
//
// Geen clampConcurrency hier: dit pakket draait v1 bewust maar ÉÉN run
// tegelijk (zie run-state.ts), dus er is geen concurrency-instelling om te
// klemmen zoals bij packages/dashboard.

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

// url/domains/maxSteps zijn optioneel: runner.ts (en daaronder validateAssignment())
// valideert ze zelf nogmaals, hier hoeven we alleen het type te bewaken zodat er
// geen rommel de run-state in komt.
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
