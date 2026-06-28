import type { Action, Snapshot } from "@yad/shared";
import type { ChatMessage as EngineChatMessage } from "../engine/types.js";

export interface HistoryItem {
  action: Action;
  ok: boolean;
  detail?: string;
}

const SYSTEM = `You are Yad, a careful browser-automation agent. You control a REAL browser through a "Hand".
Each turn you receive the current page snapshot: a compact list of interactive elements, each with a stable ref.
You must output EXACTLY ONE action as a single JSON object and NOTHING else (no prose, no markdown fences).

Available actions:
{ "kind": "navigate", "url": "https://..." }
{ "kind": "click", "ref": "e3" }
{ "kind": "type", "ref": "e5", "text": "...", "submit": false }
{ "kind": "select", "ref": "e7", "value": "..." }
{ "kind": "extract", "what": "what to read", "ref": "e2" }   // ref optional
{ "kind": "wait", "ms": 1000 }
{ "kind": "finish", "summary": "what you accomplished" }

Rules:
- Output ONLY the JSON object.
- Use refs exactly as shown in the snapshot. Never invent a ref.
- NEVER attempt to pay, place orders, or checkout; those are blocked by the system.
- Take the smallest sensible next step. Use extract to read info.
- When the goal is achieved (or impossible), output a finish action with a short summary.`;

function renderSnapshot(s: Snapshot): string {
  const lines = s.nodes
    .slice(0, 120)
    .map((n) => {
      const val = n.value ? ` =${JSON.stringify(n.value.slice(0, 60))}` : "";
      const dis = n.disabled ? " (disabled)" : "";
      return `  ${n.ref} ${n.role} ${JSON.stringify(n.name.slice(0, 80))}${val}${dis}`;
    })
    .join("\n");
  return [
    `URL: ${s.url}`,
    `Title: ${s.title}`,
    `Interactive elements (ref role name):`,
    lines || "  (none)",
    `Page text (short): ${s.textDigest.slice(0, 600)}`,
  ].join("\n");
}

function renderHistory(history: HistoryItem[]): string {
  if (history.length === 0) return "(no actions yet)";
  return history
    .slice(-6)
    .map((h, i) => {
      const a = JSON.stringify(h.action);
      return `  ${i + 1}. ${a} -> ${h.ok ? "ok" : "FOUT"}${h.detail ? ` (${h.detail})` : ""}`;
    })
    .join("\n");
}

/** Bouwt de berichten voor de LLM voor één stap van de lus. */
export function buildMessages(
  goal: string,
  snapshot: Snapshot,
  history: HistoryItem[],
): EngineChatMessage[] {
  const user = [
    `GOAL: ${goal}`,
    ``,
    `CURRENT PAGE:`,
    renderSnapshot(snapshot),
    ``,
    `RECENT ACTIONS:`,
    renderHistory(history),
    ``,
    `Output the single next action as JSON.`,
  ].join("\n");

  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}
