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

export interface LlmProviderSettings {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly maxTokens: number | undefined;
  readonly enableThinking: boolean;
  readonly enableWebSearch: boolean;
}

export interface LlmProviderControl extends LlmStreamClient {
  getProviderSettings(): LlmProviderSettings;
  updateProviderSettings(settings: LlmProviderSettings): void;
  testConnection(): Promise<void>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAICompatibleClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly fetchImpl?: FetchLike;
  readonly maxTokens?: number;
  readonly enableThinking?: boolean;
  readonly enableWebSearch?: boolean;
  readonly sleepImpl?: (milliseconds: number) => Promise<void>;
}

export class LlmProviderError extends Error {
  override readonly name = "LlmProviderError";
}

const MAX_REQUEST_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 1_000;

export class OpenAICompatibleClient implements LlmProviderControl {
  #apiKey: string;
  #model: string;
  #endpoint: string;
  #fetch: FetchLike;
  #maxTokens: number | undefined;
  #enableThinking: boolean;
  #enableWebSearch: boolean;
  #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: OpenAICompatibleClientOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#endpoint = chatCompletionsEndpoint(options.baseUrl);
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#sleep = options.sleepImpl ?? sleep;
    this.#maxTokens = options.maxTokens;
    this.#enableThinking = options.enableThinking ?? true;
    this.#enableWebSearch = options.enableWebSearch ?? false;
  }

  getProviderSettings(): LlmProviderSettings {
    return {
      baseUrl: baseUrlFromChatCompletionsEndpoint(this.#endpoint),
      apiKey: this.#apiKey,
      model: this.#model,
      maxTokens: this.#maxTokens,
      enableThinking: this.#enableThinking,
      enableWebSearch: this.#enableWebSearch,
    };
  }

  updateProviderSettings(settings: LlmProviderSettings): void {
    this.#apiKey = settings.apiKey;
    this.#model = settings.model;
    this.#endpoint = chatCompletionsEndpoint(settings.baseUrl);
    this.#maxTokens = settings.maxTokens;
    this.#enableThinking = settings.enableThinking;
    this.#enableWebSearch = settings.enableWebSearch;
  }

  async testConnection(): Promise<void> {
    const body: Record<string, unknown> = {
      model: this.#model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 16,
      ...(this.#enableThinking ? {} : { enable_thinking: false }),
    };
    if (this.#enableWebSearch) {
      body.tools = [OPENROUTER_WEB_SEARCH_TOOL];
    }
    const response = await this.#fetchWithRetry(JSON.stringify(body));
    if (!response.ok) {
      throw await providerHttpError(response);
    }
    try {
      await response.json();
    } catch {
      throw new LlmProviderError("The LLM provider returned a non-JSON response.");
    }
  }

  async stream(request: StreamCompletionRequest): Promise<string> {
    const messages = request.systemPrompt === undefined
      ? request.messages
      : [{ role: "system" as const, content: request.systemPrompt }, ...request.messages];
    const body: Record<string, unknown> = { model: this.#model, messages };
    if (this.#maxTokens !== undefined) {
      body.max_tokens = this.#maxTokens;
    }
    if (!this.#enableThinking) {
      body.enable_thinking = false;
    }
    if (this.#enableWebSearch) {
      body.tools = [OPENROUTER_WEB_SEARCH_TOOL];
    }
    const response = await this.#fetchWithRetry(JSON.stringify(body));

    if (!response.ok) {
      throw await providerHttpError(response);
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

    const completedContent = appendWebCitations(content, payload);
    await request.onDelta(completedContent);
    return completedContent;
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

const CHAT_COMPLETIONS_PATH = "/chat/completions";

const OPENROUTER_WEB_SEARCH_TOOL = {
  type: "openrouter:web_search",
  parameters: {
    engine: "auto",
    max_results: 3,
    max_uses: 1,
    search_context_size: "low",
  },
} as const;

function chatCompletionsEndpoint(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return normalizedBaseUrl.endsWith(CHAT_COMPLETIONS_PATH)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}${CHAT_COMPLETIONS_PATH}`;
}

function baseUrlFromChatCompletionsEndpoint(endpoint: string): string {
  return endpoint.endsWith(CHAT_COMPLETIONS_PATH)
    ? endpoint.slice(0, -CHAT_COMPLETIONS_PATH.length)
    : endpoint;
}

async function providerHttpError(response: Response): Promise<LlmProviderError> {
  const providerMessage = await readProviderErrorMessage(response);
  return new LlmProviderError(
    providerMessage === undefined
      ? `The LLM provider returned HTTP ${response.status}.`
      : `The LLM provider returned HTTP ${response.status}: ${providerMessage}`,
  );
}

async function readProviderErrorMessage(response: Response): Promise<string | undefined> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return undefined;
  }

  if (typeof payload !== "object" || payload === null || !("error" in payload)) {
    return undefined;
  }
  const error = payload.error;
  if (
    typeof error !== "object"
    || error === null
    || !("message" in error)
    || typeof error.message !== "string"
  ) {
    return undefined;
  }
  const message = error.message.trim();
  return message.length === 0 ? undefined : message.slice(0, 500);
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
function appendWebCitations(content: string, payload: unknown): string {
  if (
    typeof payload !== "object"
    || payload === null
    || !("choices" in payload)
    || !Array.isArray(payload.choices)
    || payload.choices.length === 0
  ) {
    return content;
  }
  const firstChoice = payload.choices[0];
  if (
    typeof firstChoice !== "object"
    || firstChoice === null
    || !("message" in firstChoice)
    || typeof firstChoice.message !== "object"
    || firstChoice.message === null
    || !("annotations" in firstChoice.message)
    || !Array.isArray(firstChoice.message.annotations)
  ) {
    return content;
  }

  const citations = new Map<string, string>();
  for (const annotation of firstChoice.message.annotations) {
    if (
      typeof annotation !== "object"
      || annotation === null
      || !("type" in annotation)
      || annotation.type !== "url_citation"
      || !("url_citation" in annotation)
      || typeof annotation.url_citation !== "object"
      || annotation.url_citation === null
      || !("url" in annotation.url_citation)
      || typeof annotation.url_citation.url !== "string"
    ) {
      continue;
    }
    const url = annotation.url_citation.url;
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        continue;
      }
      const title = "title" in annotation.url_citation && typeof annotation.url_citation.title === "string"
        ? annotation.url_citation.title.trim()
        : "";
      citations.set(url, title.length === 0 ? parsedUrl.hostname : title);
    } catch {
      continue;
    }
  }

  if (citations.size === 0) {
    return content;
  }
  const citationLines = [...citations.entries()]
    .slice(0, 5)
    .map(([url, title]) => `- [${title}](${url})`);
  return `${content.trimEnd()}\n\n출처:\n${citationLines.join("\n")}`;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
