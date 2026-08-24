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
  readonly conversationId: string;
  readonly prompt: string;
  readonly transport: ConversationTransport;
}

export interface ConversationServiceOptions {
  readonly maxHistoryMessages: number;
  readonly systemPrompt: string | undefined;
  readonly logger?: Logger;
}

export class ConversationService {
  readonly #llm: ChatCompletionClient;
  readonly #maxHistoryMessages: number;
  readonly #systemPrompt: string | undefined;
  readonly #logger: Logger;
  readonly #histories = new Map<string, readonly ChatMessage[]>();
  readonly #queue = new KeyedSerialQueue();

  constructor(llm: ChatCompletionClient, options: ConversationServiceOptions) {
    if (!Number.isSafeInteger(options.maxHistoryMessages) || options.maxHistoryMessages <= 0) {
      throw new RangeError("maxHistoryMessages must be a positive integer.");
    }

    this.#llm = llm;
    this.#maxHistoryMessages = options.maxHistoryMessages;
    this.#systemPrompt = options.systemPrompt;
    this.#logger = options.logger ?? consoleLogger;
  }

  async handle(request: ConversationRequest): Promise<void> {
    try {
      await this.#queue.run(request.conversationId, async () => {
        await this.#process(request);
      });
    } catch (error) {
      this.#logger.error("Unexpected conversation processing failure.", {
        conversationId: request.conversationId,
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
        conversationId: request.conversationId,
        error: summarizeError(error),
      });
    }

    const history = this.#histories.get(request.conversationId) ?? [];
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
        conversationId: request.conversationId,
        error: summarizeError(error),
      });
      await this.#sendFailureReply(request);
      return;
    }

    const chunks = splitDiscordMessage(response);
    if (chunks.length === 0) {
      this.#logger.error("LLM completion contained no sendable text.", {
        conversationId: request.conversationId,
      });
      await this.#sendFailureReply(request);
      return;
    }

    for (const [chunkIndex, chunk] of chunks.entries()) {
      try {
        await request.transport.sendMessage(chunk);
      } catch (error) {
        this.#logger.error("Discord response send failed.", {
          conversationId: request.conversationId,
          chunkNumber: chunkIndex + 1,
          chunkCount: chunks.length,
          error: summarizeError(error),
        });
        await this.#sendFailureReply(request);
        return;
      }
    }

    const assistantMessage: ChatMessage = { role: "assistant", content: response };
    const updatedHistory = [...history, userMessage, assistantMessage];
    const retainedHistory = updatedHistory.length > this.#maxHistoryMessages
      ? updatedHistory.slice(-this.#maxHistoryMessages)
      : updatedHistory;
    this.#histories.set(request.conversationId, retainedHistory);
  }

  async #sendFailureReply(request: ConversationRequest): Promise<void> {
    try {
      await request.transport.sendMessage(USER_FAILURE_MESSAGE);
    } catch (error) {
      this.#logger.error("Discord failure reply could not be sent.", {
        conversationId: request.conversationId,
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
