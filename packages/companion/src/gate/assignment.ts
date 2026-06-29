/**
 * Assignment — de toewijzing die de Koning Claude geeft vóór een autonome run.
 *
 * VEILIGHEIDSPRINCIPE:
 *   Elke autonome Yad-run vereist een Assignment. De ScopeGuard vergrendelt de
 *   HandBridge zodat NIETS buiten de toewijzing kan worden gedaan, ook niet per
 *   ongeluk. Geen Assignment = geen run.
 *
 * Hoe het werkt:
 *   1. De Koning schrijft een assignment.json (of Claude genereert er één en toont hem).
 *   2. validateAssignment() weigert onveilige of te brede toewijzingen hard.
 *   3. ScopeGuard inspecteert elke actie. Overtreding = STOP + log.
 *   4. Run-history.jsonl legt elk stap vast voor de Koning.
 */

export interface Assignment {
  /** Uniek ID, bv. "REDACTED-idor-2026-06-29-A" */
  id: string;
  /** Omschrijving voor de Koning (menselijk leesbaar) */
  description: string;
  /** Domeinen waarop de agent MAG navigeren, bv. ["api.REDACTED.nl", "www.REDACTED.nl"] */
  targetDomains: string[];
  /** Maximaal toegestane navigatie-acties (harde cap tegen eindeloze loops) */
  maxActions: number;
  /** Doel-goal die de agent krijgt */
  goal: string;
  /** Wie de toewijzing heeft ondertekend — altijd de Koning */
  signedBy: "king";
  /** Unix-ms van aanmaak */
  createdAt: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const MAX_ALLOWED_DOMAINS = 5;
const MAX_ALLOWED_ACTIONS = 200;

/**
 * Pre-run veiligheidscheck: weigert elke Assignment die te breed, leeg of gevaarlijk is.
 * Dit is de software-equivalent van muraqib-al-aman — een harde poort vóór de run begint.
 */
export function validateAssignment(a: unknown): ValidationResult {
  const errors: string[] = [];

  if (!a || typeof a !== "object") {
    return { ok: false, errors: ["Assignment is geen object."] };
  }
  const obj = a as Record<string, unknown>;

  if (typeof obj["id"] !== "string" || !obj["id"]) errors.push("id ontbreekt of leeg.");
  if (typeof obj["description"] !== "string" || !obj["description"]) errors.push("description ontbreekt.");
  if (typeof obj["goal"] !== "string" || !obj["goal"]) errors.push("goal ontbreekt of leeg.");
  if (obj["signedBy"] !== "king") errors.push('signedBy moet "king" zijn — alleen de Koning mag een toewijzing ondertekenen.');

  if (!Array.isArray(obj["targetDomains"]) || obj["targetDomains"].length === 0) {
    errors.push("targetDomains is leeg — specificeer minstens één domein.");
  } else {
    if (obj["targetDomains"].length > MAX_ALLOWED_DOMAINS) {
      errors.push(`targetDomains mag maximaal ${MAX_ALLOWED_DOMAINS} domeinen bevatten (ontvangen: ${(obj["targetDomains"] as unknown[]).length}).`);
    }
    for (const d of obj["targetDomains"] as unknown[]) {
      if (typeof d !== "string" || !d) {
        errors.push("targetDomains bevat een lege of niet-string waarde.");
      } else if (d.includes("*")) {
        errors.push(`Wildcards niet toegestaan in targetDomains: "${d}". Wees specifiek.`);
      }
    }
  }

  const maxActions = obj["maxActions"];
  if (typeof maxActions !== "number" || maxActions <= 0) {
    errors.push("maxActions moet een positief getal zijn.");
  } else if (maxActions > MAX_ALLOWED_ACTIONS) {
    errors.push(`maxActions mag maximaal ${MAX_ALLOWED_ACTIONS} zijn (ontvangen: ${maxActions}). Verdeel grote taken in kleinere assignments.`);
  }

  return { ok: errors.length === 0, errors };
}

/** Geeft true als de URL binnen de toewijzings-domeinen valt. */
export function isUrlInAssignment(url: string, assignment: Assignment): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  return assignment.targetDomains.some((d) => {
    const target = d.toLowerCase().replace(/^www\./, "");
    return host === target || host.endsWith(`.${target}`);
  });
}
