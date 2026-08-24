import { splitDiscordMessage } from "./chunking.js";
import type { ChatCompletionClient, ChatMessage } from "./llm.js";
import { consoleLogger, summarizeError, type Logger } from "./logging.js";

export const USER_FAILURE_MESSAGE =
  "Sorry, I couldn't generate a response right now. Please try again.";

export interface ConversationTransport {
  sendTyping(): Promise<void>;
  sendMessage(content: string): Promise<void>;
}

export interface ConversationRequest {
  readonly channelId: string;
  readonly guildId: string | null;
  readonly userId: string;
  readonly botUserId: string;
  readonly prompt: string;
  readonly transport: ConversationTransport;
}

export interface ConversationExchange {
  readonly channelId: string;
  readonly guildId: string | null;
  readonly userId: string;
  readonly botUserId: string;
  readonly userMessage: string;
  readonly assistantMessage: string;
}

export interface ConversationStore {
  getRecent(channelId: string, limit: number): Promise<readonly ChatMessage[]>;
  appendExchange(exchange: ConversationExchange): Promise<void>;
}

export interface ConversationServiceOptions {
  readonly maxHistoryMessages: number;
  readonly systemPrompt: string | undefined;
  readonly store: ConversationStore;
  readonly logger?: Logger;
}

export class ConversationService {
  readonly #llm: ChatCompletionClient;
  readonly #maxHistoryMessages: number;
  readonly #systemPrompt: string | undefined;
  readonly #store: ConversationStore;
  readonly #logger: Logger;
  readonly #queue = new KeyedSerialQueue();

  constructor(llm: ChatCompletionClient, options: ConversationServiceOptions) {
    if (!Number.isSafeInteger(options.maxHistoryMessages) || options.maxHistoryMessages <= 0) {
      throw new RangeError("maxHistoryMessages must be a positive integer.");
    }

    this.#llm = llm;
    this.#maxHistoryMessages = options.maxHistoryMessages;
    this.#systemPrompt = options.systemPrompt;
    this.#store = options.store;
    this.#logger = options.logger ?? consoleLogger;
  }

  async handle(request: ConversationRequest): Promise<void> {
    try {
      await this.#queue.run(request.channelId, async () => {
        await this.#process(request);
      });
    } catch (error) {
      this.#logger.error("Unexpected conversation processing failure.", {
        channelId: request.channelId,
        error: summarizeError(error),
      });
      await this.#sendFailureReply(request);
    }
  }

  async #process(request: ConversationRequest): Promise<void> {
    try {
      await request.transport.sendTyping();
    } catch (error) {
      this.#logger.warn("Could not send Discord typing indicator; continuing.", {
        channelId: request.channelId,
        error: summarizeError(error),
      });
    }

    let history: readonly ChatMessage[];
    try {
      history = await this.#store.getRecent(request.channelId, this.#maxHistoryMessages);
    } catch (error) {
      this.#logger.error("Conversation history load failed.", {
        channelId: request.channelId,
        error: summarizeError(error),
      });
      await this.#sendFailureReply(request);
      return;
    }

    const userMessage: ChatMessage = { role: "user", content: request.prompt };
    const messages = [...history, userMessage];

    let response: string;
    try {
      response = await this.#llm.complete({
        messages,
        systemPrompt: this.#systemPrompt,
      });
    } catch (error) {
      this.#logger.error("LLM completion failed.", {
        channelId: request.channelId,
        error: summarizeError(error),
      });
      await this.#sendFailureReply(request);
      return;
    }

    const chunks = splitDiscordMessage(response);
    if (chunks.length === 0) {
      this.#logger.error("LLM completion contained no sendable text.", {
        channelId: request.channelId,
      });
      await this.#sendFailureReply(request);
      return;
    }

    for (const [chunkIndex, chunk] of chunks.entries()) {
      try {
        await request.transport.sendMessage(chunk);
      } catch (error) {
        this.#logger.error("Discord response send failed.", {
          channelId: request.channelId,
          chunkNumber: chunkIndex + 1,
          chunkCount: chunks.length,
          error: summarizeError(error),
        });
        await this.#sendFailureReply(request);
        return;
      }
    }

    try {
      await this.#store.appendExchange({
        channelId: request.channelId,
        guildId: request.guildId,
        userId: request.userId,
        botUserId: request.botUserId,
        userMessage: request.prompt,
        assistantMessage: response,
      });
    } catch (error) {
      this.#logger.error("Conversation history persistence failed.", {
        channelId: request.channelId,
        error: summarizeError(error),
      });
    }
  }

  async #sendFailureReply(request: ConversationRequest): Promise<void> {
    try {
      await request.transport.sendMessage(USER_FAILURE_MESSAGE);
    } catch (error) {
      this.#logger.error("Discord failure reply could not be sent.", {
        channelId: request.channelId,
        error: summarizeError(error),
      });
    }
  }
}

class KeyedSerialQueue {
  readonly #tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );

    this.#tails.set(key, tail);
    void tail.then(() => {
      if (this.#tails.get(key) === tail) {
        this.#tails.delete(key);
      }
    });

    return result;
  }
}
