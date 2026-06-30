/**
 * Sprint 6 — Judge
 *
 * Beoordeelt of een browser-actie het verwachte resultaat heeft opgeleverd.
 * Ternair: match / mismatch / unknown — geen boolean, nooit stuurrecht.
 *
 * Regels:
 * - Mechanische mislukkingen (ref not found, timeout) komen hier NIET binnen;
 *   de executor handelt die af vóór de Judge-aanroep.
 * - Judge krijgt: wat werd verwacht + wat was de werkelijkheid.
 * - "unknown" = onvoldoende bewijs → loop gaat door met "uncertain" vlag.
 * - Confidence is een log-signaal, geen stuur-signaal.
 * - Bij 3 opeenvolgende "unknown" → escaleer naar de mens (in loop.ts).
 */

import type { ChatRequest } from "../engine/types.js";

/** Minimale router-interface — structureel compatibel met ChatLike in loop.ts. */
interface Router {
  chat(req: ChatRequest): Promise<{ content: string; provider?: string }>;
}

export type JudgeVerdict = "match" | "mismatch" | "unknown";

export interface JudgeResult {
  verdict: JudgeVerdict;
  evidence: string;
}

export interface JudgeInput {
  expected: string;
  url: string;
  extracted?: string;
  /** true als de actie zelf slaagde (ok=true) — proxy voor "er is iets veranderd". */
  hadEffect: boolean;
}

const JUDGE_SYSTEM = `You are a browser-action step verifier.
Given the expected outcome of an action and the actual evidence, classify the outcome.

Output ONLY valid JSON: {"verdict":"match"|"mismatch"|"unknown","evidence":"one sentence"}

match — evidence clearly confirms the expected outcome
mismatch — evidence clearly contradicts the expected outcome
unknown — evidence is absent, unclear, or too ambiguous to decide`;

const VALID_VERDICTS: readonly string[] = ["match", "mismatch", "unknown"];

export function parseJudgeRaw(raw: string): JudgeResult {
  try {
    const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    if (start === -1) return { verdict: "unknown", evidence: "geen JSON in antwoord" };
    const obj = JSON.parse(cleaned.slice(start)) as Record<string, unknown>;
    const verdict =
      typeof obj["verdict"] === "string" && VALID_VERDICTS.includes(obj["verdict"])
        ? (obj["verdict"] as JudgeVerdict)
        : "unknown";
    const evidence = typeof obj["evidence"] === "string" ? obj["evidence"] : "";
    return { verdict, evidence };
  } catch {
    return { verdict: "unknown", evidence: "parse-fout in Judge-antwoord" };
  }
}

export async function callJudge(router: Router, input: JudgeInput): Promise<JudgeResult> {
  const userText = JSON.stringify({
    expected: input.expected,
    had_effect: input.hadEffect,
    extracted: input.extracted ?? null,
    url: input.url,
  });

  try {
    const res = await router.chat({
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: userText },
      ],
      temperature: 0,
      json: true,
      maxTokens: 80,
    });
    return parseJudgeRaw(res.content);
  } catch {
    return { verdict: "unknown", evidence: "Judge-aanroep mislukt" };
  }
}
