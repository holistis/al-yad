import type { ChatRequest, ChatResponse, LlmProvider } from "../types.js";
import { LlmError, isRetryableStatus } from "../errors.js";

export interface OpenAICompatibleOptions {
  name: string;
  baseUrl: string; // bv. https://api.groq.com/openai/v1  of  http://localhost:11434/v1
  apiKey?: string; // Ollama heeft er geen nodig
  model: string;
  tier: number;
  extraHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch; // injecteerbaar voor tests
  timeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Generieke provider voor elk OpenAI-compatibel endpoint: Groq, Gemini
 * (v1beta/openai), OpenRouter, Cerebras en lokaal Ollama (/v1).
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly tier: number;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: OpenAICompatibleOptions) {
    this.name = opts.name;
    this.model = opts.model;
    this.tier = opts.tier;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.extraHeaders = opts.extraHeaders ?? {};
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.extraHeaders,
    };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: req.messages,
    };
    if (typeof req.temperature === "number") body["temperature"] = req.temperature;
    if (typeof req.maxTokens === "number") body["max_tokens"] = req.maxTokens;
    if (req.json) body["response_format"] = { type: "json_object" };

    // Eigen timeout, gekoppeld aan een eventueel meegegeven signal.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new LlmError(`${this.name}: netwerkfout: ${(err as Error).message}`, {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LlmError(`${this.name}: HTTP ${res.status} ${text.slice(0, 200)}`, {
        status: res.status,
        retryable: isRetryableStatus(res.status),
      });
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new LlmError(`${this.name}: geen content in antwoord`, { retryable: false });
    }

    return {
      content,
      model: this.model,
      provider: this.name,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
      },
    };
  }
}
