import type { ChatMessage, ChatRole, LlmStreamClient } from "./llm.js";
import { consoleLogger, summarizeError, type Logger } from "./logging.js";
import {
  LiveStreamWriter,
  type LiveStreamWriterOptions,
  type StreamableChannelTransport,
} from "./stream-writer.js";

export const USER_FAILURE_MESSAGE =
  "Sorry, I couldn't generate a response right now. Please try again.";

export interface ConversationTransport extends StreamableChannelTransport {
  sendFailureNotice(content: string): Promise<void>;
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

export interface RelevantContext {
  readonly role: ChatRole;
  readonly content: string;
  readonly createdAt?: Date;
}

export interface ConversationStore {
  getRecent(channelId: string, limit: number): Promise<readonly ChatMessage[]>;
  appendExchange(exchange: ConversationExchange): Promise<void>;
  findRelevant?(query: string, options?: { channelId?: string; limit?: number }): Promise<readonly RelevantContext[]>;
}

export interface ConversationServiceOptions {
  readonly maxHistoryMessages: number;
  readonly systemPrompt: string | undefined;
  readonly store: ConversationStore;
  readonly streamOptions?: LiveStreamWriterOptions;
  readonly logger?: Logger;
}
export class ConversationService {
  readonly #llm: LlmStreamClient;
  readonly #maxHistoryMessages: number;
  #systemPrompt: string | undefined;
  readonly #store: ConversationStore;
  readonly #streamOptions: LiveStreamWriterOptions | undefined;
  readonly #logger: Logger;

  constructor(llm: LlmStreamClient, options: ConversationServiceOptions) {
    if (!Number.isSafeInteger(options.maxHistoryMessages) || options.maxHistoryMessages <= 0) {
      throw new RangeError("maxHistoryMessages must be a positive integer.");
    }

    this.#llm = llm;
    this.#maxHistoryMessages = options.maxHistoryMessages;
    this.#systemPrompt = options.systemPrompt;
    this.#store = options.store;
    this.#streamOptions = options.streamOptions;
    this.#logger = options.logger ?? consoleLogger;
  }

  setSystemPrompt(systemPrompt: string | undefined): void {
    this.#systemPrompt = systemPrompt;
  }

  get systemPrompt(): string | undefined {
    return this.#systemPrompt;
  }

  async handle(request: ConversationRequest): Promise<void> {
    try {
      await this.#process(request);
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
    let relevantContext: readonly RelevantContext[] = [];
    try {
      const [recentHistory, context] = await Promise.all([
        this.#store.getRecent(request.channelId, this.#maxHistoryMessages),
        this.#store.findRelevant
          ? this.#store.findRelevant(request.prompt, { channelId: request.channelId, limit: 3 })
          : Promise.resolve([]),
      ]);
      history = recentHistory;
      relevantContext = context;
    } catch (error) {
      this.#logger.error("Conversation history load failed.", {
        channelId: request.channelId,
        error: summarizeError(error),
      });
      await this.#sendFailureReply(request);
      return;
    }

    const systemPrompt = this.#buildSystemPromptWithContext(relevantContext);
    const userMessage: ChatMessage = { role: "user", content: request.prompt };
    const messages = [...history, userMessage];
    const writer = new LiveStreamWriter(request.transport, this.#streamOptions);

    let response: string;
    try {
      response = await this.#llm.stream({
        messages,
        systemPrompt,
        onDelta: async (delta) => {
          await writer.appendDelta(delta);
        },
      });
    } catch (error) {
      this.#logger.error("Gemini stream completion failed.", {
        channelId: request.channelId,
        error: summarizeError(error),
      });
      await this.#sendFailureReply(request);
      return;
    }

    try {
      await writer.finish();
    } catch (error) {
      this.#logger.error("Discord stream delivery failed.", {
        channelId: request.channelId,
        error: summarizeError(error),
      });
      await this.#sendFailureReply(request);
      return;
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

  #buildSystemPromptWithContext(relevantContext: readonly RelevantContext[]): string | undefined {
    if (relevantContext.length === 0) {
      return this.#systemPrompt;
    }

    const contextSnippet = relevantContext
      .map((item) => `[과거 기록] ${item.role === "user" ? "사용자" : "어시스턴트"}: ${item.content}`)
      .join("\n");

    const contextPrompt = `[참고: 관련된 과거 채널 대화 및 지식]\n${contextSnippet}\n위 과거 대화와 지식을 필요시 자연스럽게 참고하여 답변해.`;

    if (this.#systemPrompt === undefined || this.#systemPrompt.trim().length === 0) {
      return contextPrompt;
    }

    return `${this.#systemPrompt}\n\n${contextPrompt}`;
  }
  async #sendFailureReply(request: ConversationRequest): Promise<void> {
    try {
      await request.transport.sendFailureNotice(USER_FAILURE_MESSAGE);
    } catch (error) {
      this.#logger.error("Discord failure reply could not be sent.", {
        channelId: request.channelId,
        error: summarizeError(error),
      });
    }
  }
}


