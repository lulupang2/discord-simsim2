export type ChatRole = "user" | "assistant";
export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface GeminiContentItem {
  readonly role: "user" | "model";
  readonly parts: readonly { readonly text: string }[];
}

export interface StreamCompletionRequest {
  readonly messages: readonly ChatMessage[];
  readonly systemPrompt: string | undefined;
  readonly onDelta: (text: string) => Promise<void> | void;
}

export interface LlmStreamClient {
  stream(request: StreamCompletionRequest): Promise<string>;
}

export interface GeminiInteractionsClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly thinkingLevel?: GeminiThinkingLevel;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly sleepImpl?: (milliseconds: number) => Promise<void>;
}

export class LlmProviderError extends Error {
  override readonly name = "LlmProviderError";
}

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_THINKING_LEVEL: GeminiThinkingLevel = "low";
const MAX_REQUEST_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 1_000;

export class GeminiInteractionsClient implements LlmStreamClient {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #thinkingLevel: GeminiThinkingLevel;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: GeminiInteractionsClientOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#thinkingLevel = options.thinkingLevel ?? DEFAULT_THINKING_LEVEL;

    let base = (options.baseUrl ?? DEFAULT_GEMINI_BASE_URL).trim().replace(/\/+$/, "");
    base = base
      .replace(/\/v1beta\/(?:openai|interactions)$/i, "")
      .replace(/\/openai$/i, "")
      .replace(/\/v1$/i, "")
      .replace(/\/+$/, "");
    if (!base.startsWith("http://") && !base.startsWith("https://")) {
      base = DEFAULT_GEMINI_BASE_URL;
    }

    this.#endpoint = `${base}/v1beta/interactions?alt=sse`;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#sleep = options.sleepImpl ?? sleep;
  }

  async stream(request: StreamCompletionRequest): Promise<string> {
    const input = toGeminiContents(request.messages);
    const body: Record<string, unknown> = {
      model: this.#model,
      input,
      stream: true,
      store: false,
      service_tier: "priority",
      generation_config: {
        thinking_level: this.#thinkingLevel,
      },
    };

    if (request.systemPrompt !== undefined && request.systemPrompt.trim().length > 0) {
      body.system_instruction = request.systemPrompt;
    }

    const response = await this.#fetchWithRetry(JSON.stringify(body));

    if (!response.ok) {
      throw new LlmProviderError(`The Gemini API returned HTTP ${response.status}.`);
    }

    if (response.body === null) {
      throw new LlmProviderError("The Gemini API returned an empty response body.");
    }

    let assembled = "";
    try {
      for await (const deltaText of parseGeminiEventStream(response.body)) {
        assembled += deltaText;
        await request.onDelta(deltaText);
      }
    } catch (error) {
      if (error instanceof LlmProviderError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new LlmProviderError(`The Gemini stream encountered an unexpected error: ${message}`);
    }

    if (assembled.trim().length === 0) {
      throw new LlmProviderError("The Gemini API returned no text response.");
    }

    return assembled;
  }
  async #fetchWithRetry(body: string): Promise<Response> {
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch(this.#endpoint, {
          method: "POST",
          headers: {
            "x-goog-api-key": this.#apiKey,
            "content-type": "application/json",
          },
          body,
        });
      } catch {
        if (attempt === MAX_REQUEST_ATTEMPTS) {
          throw new LlmProviderError("Could not reach the Gemini API.");
        }
        await this.#sleep(retryDelayMs(attempt));
        continue;
      }

      const retryable = response.status === 429 || response.status === 503;
      if (!retryable || attempt === MAX_REQUEST_ATTEMPTS) {
        return response;
      }

      if (response.body !== null) {
        await response.body.cancel().catch(() => undefined);
      }
      await this.#sleep(retryDelayMs(attempt, response.headers.get("retry-after")));
    }

    throw new LlmProviderError("Could not reach the Gemini API.");
  }
}


function retryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1_000, 10_000);
  }
  return Math.min(RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)), 10_000);
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function toGeminiContents(messages: readonly ChatMessage[]): GeminiContentItem[] {
  return messages.map((entry) => ({
    role: entry.role === "assistant" ? "model" : "user",
    parts: [{ text: entry.content }],
  }));
}

async function* parseGeminiEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const delta = extractTextDeltaFromEventBlock(block);
        if (delta !== undefined && delta.length > 0) {
          yield delta;
        }
      }
    }

    if (buffer.trim().length > 0) {
      const delta = extractTextDeltaFromEventBlock(buffer);
      if (delta !== undefined && delta.length > 0) {
        yield delta;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractTextDeltaFromEventBlock(block: string): string | undefined {
  const lines = block.split(/\r?\n/);
  let eventType: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  const rawData = dataLines.join("\n");
  if (rawData === "[DONE]") {
    return undefined;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawData);
  } catch {
    return undefined;
  }

  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  if ("error" in payload) {
    throw new LlmProviderError("The Gemini stream reported an error event.");
  }

  // 1. Google streamGenerateContent format: candidates[0].content.parts[0].text
  if ("candidates" in payload && Array.isArray(payload.candidates) && payload.candidates.length > 0) {
    const candidate: unknown = payload.candidates[0];
    if (typeof candidate === "object" && candidate !== null && "content" in candidate) {
      const content: unknown = candidate.content;
      if (typeof content === "object" && content !== null && "parts" in content && Array.isArray(content.parts)) {
        let candidateText = "";
        for (const part of content.parts) {
          if (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string") {
            // Exclude thought text if marked as thought
            if (!("thought" in part && part.thought === true)) {
              candidateText += part.text;
            }
          }
        }
        if (candidateText.length > 0) {
          return candidateText;
        }
      }
    }
  }

  // 2. Interactions step.delta format fallback
  let payloadEventType = eventType;
  if ("event_type" in payload && typeof payload.event_type === "string") {
    payloadEventType = payload.event_type;
  }

  if (payloadEventType === "step.delta" && "delta" in payload) {
    const delta = payload.delta;
    if (
      typeof delta === "object" &&
      delta !== null &&
      "type" in delta &&
      delta.type === "text" &&
      "text" in delta &&
      typeof delta.text === "string"
    ) {
      return delta.text;
    }
  }

  return undefined;
}
