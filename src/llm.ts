export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface StreamCompletionRequest {
  readonly messages: readonly ChatMessage[];
  readonly systemPrompt: string | undefined;
  readonly onDelta: (text: string) => Promise<void> | void;
}

export interface LlmStreamClient {
  stream(request: StreamCompletionRequest): Promise<string>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAICompatibleClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly fetchImpl?: FetchLike;
  readonly sleepImpl?: (milliseconds: number) => Promise<void>;
}

export class LlmProviderError extends Error {
  override readonly name = "LlmProviderError";
}

const MAX_REQUEST_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 1_000;

export class OpenAICompatibleClient implements LlmStreamClient {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #endpoint: string;
  readonly #fetch: FetchLike;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: OpenAICompatibleClientOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#sleep = options.sleepImpl ?? sleep;
  }

  async stream(request: StreamCompletionRequest): Promise<string> {
    const messages = request.systemPrompt === undefined
      ? request.messages
      : [{ role: "system" as const, content: request.systemPrompt }, ...request.messages];
    const response = await this.#fetchWithRetry(JSON.stringify({ model: this.#model, messages }));

    if (!response.ok) {
      throw new LlmProviderError(`The LLM provider returned HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new LlmProviderError("The LLM provider returned invalid JSON.");
    }

    const content = readCompletionContent(payload);
    if (content === undefined || content.trim().length === 0) {
      throw new LlmProviderError("The LLM provider returned no text response.");
    }

    await request.onDelta(content);
    return content;
  }

  async #fetchWithRetry(body: string): Promise<Response> {
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch(this.#endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.#apiKey}`,
            "content-type": "application/json",
          },
          body,
        });
      } catch {
        if (attempt === MAX_REQUEST_ATTEMPTS) {
          throw new LlmProviderError("Could not reach the LLM provider.");
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
    throw new LlmProviderError("Could not reach the LLM provider.");
  }
}

function readCompletionContent(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null || !("choices" in payload)) {
    return undefined;
  }
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const firstChoice: unknown = choices[0];
  if (
    typeof firstChoice !== "object" ||
    firstChoice === null ||
    !("message" in firstChoice) ||
    typeof firstChoice.message !== "object" ||
    firstChoice.message === null ||
    !("content" in firstChoice.message) ||
    typeof firstChoice.message.content !== "string"
  ) {
    return undefined;
  }
  return firstChoice.message.content;
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
