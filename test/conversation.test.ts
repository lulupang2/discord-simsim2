import { describe, expect, it, vi } from "vitest";
import {
  ConversationService,
  USER_FAILURE_MESSAGE,
  type ConversationExchange,
  type ConversationRequest,
  type ConversationStore,
  type ConversationTransport,
} from "../src/conversation.js";
import type {
  ChatMessage,
  LlmStreamClient,
  StreamCompletionRequest,
} from "../src/llm.js";
import type { Logger } from "../src/logging.js";
import type {
  StreamableChannelTransport,
  StreamableMessageHandle,
} from "../src/stream-writer.js";

type CompletionBehavior = (
  request: StreamCompletionRequest,
  callIndex: number,
) => Promise<string>;

class RecordingClient implements LlmStreamClient {
  readonly requests: StreamCompletionRequest[] = [];
  readonly #behavior: CompletionBehavior;

  constructor(behavior: CompletionBehavior) {
    this.#behavior = behavior;
  }

  async stream(request: StreamCompletionRequest): Promise<string> {
    const snapshot: StreamCompletionRequest = {
      messages: request.messages.map((entry) => ({ ...entry })),
      systemPrompt: request.systemPrompt,
      onDelta: request.onDelta,
    };
    this.requests.push(snapshot);
    const result = await this.#behavior(snapshot, this.requests.length - 1);
    await request.onDelta(result);
    return result;
  }
}

class RecordingStore implements ConversationStore {
  readonly exchanges: ConversationExchange[] = [];
  readonly #messages = new Map<string, ChatMessage[]>();

  constructor(
    private readonly failReads = false,
    private readonly failWrites = false,
  ) {}

  async getRecent(channelId: string, limit: number): Promise<readonly ChatMessage[]> {
    if (this.failReads) {
      throw new Error("database read unavailable");
    }
    return (this.#messages.get(channelId) ?? [])
      .slice(-limit)
      .map((entry) => ({ ...entry }));
  }

  async appendExchange(exchange: ConversationExchange): Promise<void> {
    if (this.failWrites) {
      throw new Error("database write unavailable");
    }

    this.exchanges.push({ ...exchange });
    const messages = this.#messages.get(exchange.channelId) ?? [];
    this.#messages.set(exchange.channelId, [
      ...messages,
      { role: "user", content: exchange.userMessage },
      { role: "assistant", content: exchange.assistantMessage },
    ]);
  }

  getAll(channelId: string): readonly ChatMessage[] {
    return (this.#messages.get(channelId) ?? []).map((entry) => ({ ...entry }));
  }
}

class RecordingTransport implements ConversationTransport, StreamableChannelTransport {
  typingCount = 0;
  readonly initialSends: string[] = [];
  readonly edits: string[] = [];
  readonly finalChunks: string[] = [];
  readonly failureNotices: string[] = [];
  readonly #typingHook: (() => Promise<void>) | undefined;
  readonly #sendHook: ((content: string) => Promise<void>) | undefined;

  constructor(options: {
    typingHook?: () => Promise<void>;
    sendHook?: (content: string) => Promise<void>;
  } = {}) {
    this.#typingHook = options.typingHook;
    this.#sendHook = options.sendHook;
  }

  async sendTyping(): Promise<void> {
    this.typingCount += 1;
    await this.#typingHook?.();
  }

  async sendInitial(content: string): Promise<StreamableMessageHandle> {
    await this.#sendHook?.(content);
    this.initialSends.push(content);
    return {
      edit: async (updatedContent: string) => {
        await this.#sendHook?.(updatedContent);
        this.edits.push(updatedContent);
      },
    };
  }

  async sendFinalChunk(content: string): Promise<void> {
    await this.#sendHook?.(content);
    this.finalChunks.push(content);
  }

  async sendFailureNotice(content: string): Promise<void> {
    this.failureNotices.push(content);
  }
}

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function message(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content };
}

function request(
  channelId: string,
  prompt: string,
  transport: ConversationTransport,
): ConversationRequest {
  return {
    channelId,
    guildId: "guild",
    userId: "user",
    botUserId: "bot",
    prompt,
    transport,
  };
}

describe("ConversationService", () => {
  it("isolates database history, limits context, and keeps the system prompt external", async () => {
    const llm = new RecordingClient(async (_request, callIndex) => `answer-${callIndex + 1}`);
    const store = new RecordingStore();
    const service = new ConversationService(llm, {
      maxHistoryMessages: 2,
      systemPrompt: "system instruction",
      store,
      logger: createLogger(),
    });
    const channelA = new RecordingTransport();
    const channelB = new RecordingTransport();

    await service.handle(request("A", "A-one", channelA));
    await service.handle(request("A", "A-two", channelA));
    await service.handle(request("B", "B-one", channelB));
    await service.handle(request("A", "A-three", channelA));

    expect(llm.requests.map((entry) => entry.systemPrompt)).toEqual([
      "system instruction",
      "system instruction",
      "system instruction",
      "system instruction",
    ]);
    expect(llm.requests[0]?.messages).toEqual([message("user", "A-one")]);
    expect(llm.requests[1]?.messages).toEqual([
      message("user", "A-one"),
      message("assistant", "answer-1"),
      message("user", "A-two"),
    ]);
    expect(llm.requests[2]?.messages).toEqual([message("user", "B-one")]);
    expect(llm.requests[3]?.messages).toEqual([
      message("user", "A-two"),
      message("assistant", "answer-2"),
      message("user", "A-three"),
    ]);
    expect(store.getAll("A")).toHaveLength(6);
    expect(store.getAll("B")).toHaveLength(2);
    expect(channelA.initialSends).toEqual(["answer-1", "answer-2", "answer-4"]);
    expect(channelB.initialSends).toEqual(["answer-3"]);
  });

  it("sends a failure reply and does not persist a failed LLM turn", async () => {
    const llm = new RecordingClient(async (_request, callIndex) => {
      if (callIndex === 0) {
        throw new Error("provider unavailable");
      }
      return "recovered";
    });
    const store = new RecordingStore();
    const service = new ConversationService(llm, {
      maxHistoryMessages: 20,
      systemPrompt: undefined,
      store,
      logger: createLogger(),
    });
    const transport = new RecordingTransport();

    await service.handle(request("channel", "failed prompt", transport));
    await service.handle(request("channel", "next prompt", transport));

    expect(transport.failureNotices).toEqual([USER_FAILURE_MESSAGE]);
    expect(transport.initialSends).toEqual(["recovered"]);
    expect(llm.requests[1]?.messages).toEqual([message("user", "next prompt")]);
    expect(store.exchanges).toHaveLength(1);
  });

  it("does not persist an exchange that Discord failed to deliver", async () => {
    const llm = new RecordingClient(async (_request, callIndex) => `answer-${callIndex + 1}`);
    let sendAttempt = 0;
    const failingTransport = new RecordingTransport({
      sendHook: async () => {
        sendAttempt += 1;
        if (sendAttempt === 1) {
          throw new Error("Discord unavailable");
        }
      },
    });
    const store = new RecordingStore();
    const service = new ConversationService(llm, {
      maxHistoryMessages: 20,
      systemPrompt: undefined,
      store,
      logger: createLogger(),
    });

    await service.handle(request("channel", "not delivered", failingTransport));
    const healthyTransport = new RecordingTransport();
    await service.handle(request("channel", "next prompt", healthyTransport));

    expect(failingTransport.failureNotices).toEqual([USER_FAILURE_MESSAGE]);
    expect(llm.requests[1]?.messages).toEqual([message("user", "next prompt")]);
    expect(store.exchanges).toHaveLength(1);
  });

  it("continues after a typing-indicator failure", async () => {
    const llm = new RecordingClient(async () => "answer");
    const transport = new RecordingTransport({
      typingHook: async () => {
        throw new Error("typing unavailable");
      },
    });
    const service = new ConversationService(llm, {
      maxHistoryMessages: 20,
      systemPrompt: undefined,
      store: new RecordingStore(),
      logger: createLogger(),
    });

    await service.handle(request("channel", "prompt", transport));

    expect(transport.typingCount).toBe(1);
    expect(transport.initialSends).toEqual(["answer"]);
  });

  it("serializes overlapping requests and observes the preceding database write", async () => {
    let resolveFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    let resolveFirstCompletion: ((value: string) => void) | undefined;
    const firstCompletion = new Promise<string>((resolve) => {
      resolveFirstCompletion = resolve;
    });
    let activeCalls = 0;
    let maximumActiveCalls = 0;
    const llm = new RecordingClient(async (_request, callIndex) => {
      activeCalls += 1;
      maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
      if (callIndex === 0) {
        resolveFirstStarted?.();
        const result = await firstCompletion;
        activeCalls -= 1;
        return result;
      }
      activeCalls -= 1;
      return "second reply";
    });
    const store = new RecordingStore();
    const transport = new RecordingTransport();
    const service = new ConversationService(llm, {
      maxHistoryMessages: 20,
      systemPrompt: undefined,
      store,
      logger: createLogger(),
    });

    const first = service.handle(request("channel", "first prompt", transport));
    await firstStarted;
    const second = service.handle(request("channel", "second prompt", transport));
    await Promise.resolve();

    expect(llm.requests).toHaveLength(1);
    if (resolveFirstCompletion === undefined) {
      throw new Error("First completion resolver was not initialized.");
    }
    resolveFirstCompletion("first reply");
    await Promise.all([first, second]);

    expect(maximumActiveCalls).toBe(1);
    expect(transport.initialSends).toEqual(["first reply", "second reply"]);
    expect(llm.requests[1]?.messages).toEqual([
      message("user", "first prompt"),
      message("assistant", "first reply"),
      message("user", "second prompt"),
    ]);
  });

  it("contains a database read failure before calling the LLM", async () => {
    const llm = new RecordingClient(async () => "unused");
    const logger = createLogger();
    const transport = new RecordingTransport();
    const service = new ConversationService(llm, {
      maxHistoryMessages: 20,
      systemPrompt: undefined,
      store: new RecordingStore(true),
      logger,
    });

    await service.handle(request("channel", "prompt", transport));

    expect(llm.requests).toHaveLength(0);
    expect(transport.failureNotices).toEqual([USER_FAILURE_MESSAGE]);
    expect(logger.error).toHaveBeenCalledWith(
      "Conversation history load failed.",
      expect.objectContaining({ channelId: "channel" }),
    );
  });

  it("delivers the answer and logs when database persistence fails", async () => {
    const llm = new RecordingClient(async () => "answer");
    const logger = createLogger();
    const transport = new RecordingTransport();
    const service = new ConversationService(llm, {
      maxHistoryMessages: 20,
      systemPrompt: undefined,
      store: new RecordingStore(false, true),
      logger,
    });

    await service.handle(request("channel", "prompt", transport));

    expect(transport.initialSends).toEqual(["answer"]);
    expect(logger.error).toHaveBeenCalledWith(
      "Conversation history persistence failed.",
      expect.objectContaining({ channelId: "channel" }),
    );
  });
});
