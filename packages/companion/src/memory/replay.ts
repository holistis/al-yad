import type { Action, ActResult } from "@yad/shared";
import type { HistoryItem } from "../agent/prompt.js";
import { checkDenied, pathIsDenied } from "../gate/guardrails.js";
import type { CacheEntry } from "./cache-store.js";

export interface ReplayResult {
  /** "complete" = alle stappen ok; "drift" = stap N mislukt (site veranderd). */
  status: "complete" | "drift";
  completedSteps: HistoryItem[];
  /** 0-gebaseerde index van de eerste mislukte stap. Alleen aanwezig bij drift. */
  driftAt?: number;
}

export type ActFn = (action: Action) => Promise<ActResult>;
export type UpdateFn = (msg: string, step: number, action?: Action) => void;

/**
 * Speelt een gecachte actie-reeks deterministisch opnieuw af, zonder LLM-calls.
 * Guardrails (deny-lijst, scheme-check) worden per stap afgedwongen: een site die
 * een betaalpagina heeft toegevoegd wordt correct geblokkeerd, ook in replay.
 * Bij de eerste mislukte stap stopt de replay met status "drift".
 */
export async function replayCache(
  entry: CacheEntry,
  act: ActFn,
  update: UpdateFn,
): Promise<ReplayResult> {
  const completedSteps: HistoryItem[] = [];
  let currentUrl = "";

  for (const [i, action] of entry.actions.entries()) {
    const step = i + 1;

    if (action.kind === "navigate") currentUrl = action.url;

    // URL-niveau check (SPA's kunnen betaalpad renderen zonder navigate).
    if (currentUrl && pathIsDenied(currentUrl)) {
      return { status: "drift", completedSteps, driftAt: i };
    }

    const denied = checkDenied(action, { currentUrl });
    if (denied.denied) {
      return { status: "drift", completedSteps, driftAt: i };
    }

    update(`🔁 ${labelAction(action)}`, step, action);

    let result: ActResult;
    try {
      result = await act(action);
    } catch (e) {
      result = { ok: false, detail: (e as Error).message };
    }

    if (!result.ok) {
      return { status: "drift", completedSteps, driftAt: i };
    }

    completedSteps.push({
      action,
      ok: true,
      detail: result.extracted ? result.extracted.slice(0, 200) : result.detail,
    });
  }

  return { status: "complete", completedSteps };
}

function labelAction(action: Action): string {
  switch (action.kind) {
    case "navigate": return `Ga naar ${action.url}`;
    case "click":    return `Klik op ${action.ref}`;
    case "click-at": return `Klik op positie (${Math.round(action.xFraction * 100)}%, ${Math.round(action.yFraction * 100)}%)`;
    case "type":     return `Typ in ${action.ref}`;
    case "paste":    return `Plak in ${action.ref}`;
    case "hover":    return `Hover over ${action.ref}`;
    case "keyboard": return `Toets ${action.key}${action.ref ? ` op ${action.ref}` : ""}`;
    case "upload":        return `Upload ${action.filename} naar ${action.ref}`;
    case "upload-local":  return `Upload lokaal ${action.path} naar ${action.ref}`;
    case "select":   return `Kies in ${action.ref}`;
    case "extract":  return `Lees: ${action.what}`;
    case "scroll":   return `Scroll ${action.direction}`;
    case "wait":     return `Wacht ${action.ms}ms`;
    case "finish":   return action.summary;
  }
}
