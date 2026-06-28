export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Forceer een JSON-object-antwoord (response_format json_object) waar de provider dat steunt. */
  json?: boolean;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: string;
  usage?: ChatUsage;
}

/**
 * Een LLM-aanbieder. Alle cloud-providers (Groq, Gemini, OpenRouter, Cerebras)
 * en het lokale Ollama praten de OpenAI-compatibele dialect, dus eenzelfde
 * implementatie bedient ze allemaal; alleen baseUrl/apiKey/model verschilt.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** tier 0 = gratis-cloud, 1 = betaald, 2 = lokale bodem. Lager = eerder geprobeerd. */
  readonly tier: number;
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
}
