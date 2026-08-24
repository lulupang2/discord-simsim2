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
}

export class LlmProviderError extends Error {
  override readonly name = "LlmProviderError";
}

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_THINKING_LEVEL: GeminiThinkingLevel = "low";

export class GeminiInteractionsClient implements LlmStreamClient {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #thinkingLevel: GeminiThinkingLevel;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: GeminiInteractionsClientOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#thinkingLevel = options.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
    
    // Normalize base URL: strip trailing slashes, /v1beta/openai, /v1, etc.
    let base = (options.baseUrl ?? DEFAULT_GEMINI_BASE_URL).trim().replace(/\/+$/, "");
    base = base.replace(/\/v1beta\/openai$/i, "").replace(/\/openai$/i, "").replace(/\/v1$/i, "").replace(/\/+$/, "");
    if (!base.startsWith("http://") && !base.startsWith("https://")) {
      base = DEFAULT_GEMINI_BASE_URL;
    }

    this.#endpoint = `${base}/v1beta/models/${encodeURIComponent(this.#model)}:streamGenerateContent?alt=sse`;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  async stream(request: StreamCompletionRequest): Promise<string> {
    const contents = toGeminiContents(request.messages);
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        thinkingConfig: {
          thinkingLevel: this.#thinkingLevel,
        },
      },
    };

    if (request.systemPrompt !== undefined && request.systemPrompt.trim().length > 0) {
      body.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      };
    }

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          "x-goog-api-key": this.#apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new LlmProviderError("Could not reach the Gemini API.");
    }

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
