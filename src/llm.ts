import { Resolver } from "node:dns";
import { request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import type { LookupFunction } from "node:net";

export type ChatRole = "user" | "assistant";
export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

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

export interface GeminiInteractionsClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly thinkingLevel?: GeminiThinkingLevel;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
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
  readonly #fetch: FetchLike;
  readonly #fallbackFetch: FetchLike;
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
    this.#fetch = options.fetchImpl ?? createGeminiFetch();
    this.#fallbackFetch = createCurlGeminiFetch();
    this.#sleep = options.sleepImpl ?? sleep;
  }

  async stream(request: StreamCompletionRequest): Promise<string> {
    const input = toGeminiInput(request.messages);
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
      } catch (error) {
        if (attempt === 1) {
          try {
            return await this.#fallbackFetch(this.#endpoint, {
              method: "POST",
              headers: {
                "x-goog-api-key": this.#apiKey,
                "content-type": "application/json",
              },
              body,
            });
          } catch {
            // Continue with the bounded HTTPS retry loop below.
          }
        }
        if (attempt === MAX_REQUEST_ATTEMPTS) {
          throw new LlmProviderError(
            `Could not reach the Gemini API (${networkFailureLabel(error)}).`,
          );
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


const publicDnsResolver = new Resolver();
publicDnsResolver.setServers(["1.1.1.1", "8.8.8.8"]);

const lookupWithPublicDns: LookupFunction = (hostname, options, callback): void => {
  publicDnsResolver.resolve4(hostname, (error, addresses) => {
    const address = error === null && Array.isArray(addresses)
      ? addresses[0]
      : undefined;
    if (address !== undefined) {
      if (options.all) {
        callback(null, [{ address, family: 4 }]);
      } else {
        callback(null, address, 4);
      }
      return;
    }

    void resolveWithDnsOverHttps(hostname).then((fallbackAddress) => {
      if (options.all) {
        callback(null, [{ address: fallbackAddress, family: 4 }]);
      } else {
        callback(null, fallbackAddress, 4);
      }
    }).catch((fallbackError: unknown) => {
      const lookupError = fallbackError instanceof Error
        ? fallbackError
        : new Error(`No IPv4 address found for ${hostname}.`);
      callback(lookupError, "", 4);
    });
  });
};

function resolveWithDnsOverHttps(hostname: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const request = httpsRequest({
      hostname: "1.1.1.1",
      servername: "cloudflare-dns.com",
      path: `/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      headers: {
        host: "cloudflare-dns.com",
        accept: "application/dns-json",
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.once("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`DNS over HTTPS returned HTTP ${response.statusCode ?? 0}.`));
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          reject(new Error("DNS over HTTPS returned invalid JSON."));
          return;
        }

        if (typeof payload !== "object" || payload === null || !("Answer" in payload)) {
          reject(new Error(`DNS over HTTPS returned no answer for ${hostname}.`));
          return;
        }

        const answers = payload.Answer;
        if (!Array.isArray(answers)) {
          reject(new Error(`DNS over HTTPS returned no answer for ${hostname}.`));
          return;
        }

        for (const answer of answers) {
          if (
            typeof answer === "object" &&
            answer !== null &&
            "type" in answer &&
            answer.type === 1 &&
            "data" in answer &&
            typeof answer.data === "string" &&
            /^\d{1,3}(?:\.\d{1,3}){3}$/.test(answer.data)
          ) {
            resolve(answer.data);
            return;
          }
        }
        reject(new Error(`DNS over HTTPS returned no IPv4 answer for ${hostname}.`));
      });
      response.once("error", reject);
    });

    request.once("error", reject);
    request.setTimeout(5_000, () => {
      request.destroy(new Error("DNS over HTTPS timed out."));
    });
    request.end();
  });
}

function createGeminiFetch(): FetchLike {
  return async (input, init) => new Promise<Response>((resolve, reject) => {
    const requestHeaders = Object.fromEntries(new Headers(init.headers).entries());
    const request = httpsRequest(input, {
      method: init.method ?? "GET",
      headers: requestHeaders,
      lookup: lookupWithPublicDns,
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            responseHeaders.append(name, item);
          }
        } else if (value !== undefined) {
          responseHeaders.set(name, value);
        }
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          response.on("data", (chunk: Buffer) => {
            controller.enqueue(chunk);
          });
          response.once("end", () => {
            controller.close();
          });
          response.once("error", (error) => {
            controller.error(error);
          });
        },
        cancel() {
          response.destroy();
        },
      });

      resolve(new Response(stream, {
        status: response.statusCode ?? 500,
        headers: responseHeaders,
      }));
    });

    request.once("error", reject);
    request.setTimeout(60_000, () => {
      request.destroy(new Error("Gemini request timed out."));
    });

    if (typeof init.body === "string") {
      request.write(init.body);
    }
    request.end();
  });
}

function createCurlGeminiFetch(): FetchLike {
  return async (input, init) => new Promise<Response>((resolve, reject) => {
    const headers = new Headers(init.headers);
    const apiKey = headers.get("x-goog-api-key");
    if (apiKey === null || apiKey.length === 0) {
      reject(new Error("Gemini API key header is missing."));
      return;
    }

    const script = [
      "exec curl --silent --show-error --no-buffer --fail-with-body",
      "--noproxy \"*\"",
      "--retry 3 --retry-delay 1 --retry-all-errors --max-time 90",
      "--request POST \"$GEMINI_URL\"",
      "--header \"x-goog-api-key: $GEMINI_KEY\"",
      "--header \"content-type: application/json\"",
      "--data-binary @-",
    ].join(" ");
    const child = spawn("/bin/bash", ["-lc", script], {
      env: {
        ...process.env,
        GEMINI_URL: input,
        GEMINI_KEY: apiKey,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdout = child.stdout;
    if (stdout === null) {
      reject(new Error("curl stdout pipe was not created."));
      child.kill();
      return;
    }
    child.stderr?.resume();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        stdout.on("data", (chunk: Buffer) => {
          controller.enqueue(chunk);
        });
        child.once("error", (error) => {
          controller.error(error);
        });
        child.once("close", (code) => {
          if (code === 0) {
            controller.close();
          } else {
            controller.error(new Error(`curl exited with code ${code ?? -1}.`));
          }
        });
      },
      cancel() {
        child.kill();
      },
    });

    resolve(new Response(stream, { status: 200 }));
    if (typeof init.body === "string") {
      child.stdin?.end(init.body);
    } else {
      child.stdin?.end();
    }
  });
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

function networkFailureLabel(error: unknown): string {
  if (!(error instanceof Error)) {
    return "UnknownError";
  }
  const cause = error.cause;
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code = cause.code;
    if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) {
      return `${error.name}:${code}`;
    }
  }
  return error.name;
}

function toGeminiInput(messages: readonly ChatMessage[]): string {
  return messages
    .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}:\n${entry.content}`)
    .join("\n\n");
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
