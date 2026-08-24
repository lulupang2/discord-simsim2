export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface ChatCompletionRequest {
  readonly messages: readonly ChatMessage[];
  readonly systemPrompt: string | undefined;
}

export interface ChatCompletionClient {
  complete(request: ChatCompletionRequest): Promise<string>;
}

export interface OpenAICompatibleClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export class LlmProviderError extends Error {
  override readonly name = "LlmProviderError";
}

export class OpenAICompatibleClient implements ChatCompletionClient {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAICompatibleClientOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  async complete(request: ChatCompletionRequest): Promise<string> {
    const messages = request.systemPrompt === undefined
      ? request.messages
      : [{ role: "system" as const, content: request.systemPrompt }, ...request.messages];

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.#model,
          messages,
        }),
      });
    } catch {
      throw new LlmProviderError("Could not reach the LLM provider.");
    }

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

    return content;
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
