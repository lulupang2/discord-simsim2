import { describe, expect, it, vi } from "vitest";
import {
  ConversationService,
  USER_FAILURE_MESSAGE,
  type ConversationTransport,
} from "../src/conversation.js";
import type {
  ChatCompletionClient,
  ChatCompletionRequest,
  ChatMessage,
} from "../src/llm.js";
import type { Logger } from "../src/logging.js";

type CompletionBehavior = (
  request: ChatCompletionRequest,
  callIndex: number,
) => Promise<string>;

class RecordingClient implements ChatCompletionClient {
  readonly requests: ChatCompletionRequest[] = [];
  readonly #behavior: CompletionBehavior;

  constructor(behavior: CompletionBehavior) {
    this.#behavior = behavior;
  }

  async complete(request: ChatCompletionRequest): Promise<string> {
    const snapshot: ChatCompletionRequest = {
      messages: request.messages.map((message) => ({ ...message })),
      systemPrompt: request.systemPrompt,
    };
    this.requests.push(snapshot);
    return this.#behavior(snapshot, this.requests.length - 1);
  }
}

class RecordingTransport implements ConversationTransport {
  typingCount = 0;
  readonly attemptedMessages: string[] = [];
  readonly sentMessages: string[] = [];
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

  async sendMessage(content: string): Promise<void> {
    this.attemptedMessages.push(content);
    await this.#sendHook?.(content);
    this.sentMessages.push(content);
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

describe("ConversationService", () => {
  it("isolates channel history, evicts oldest messages, and keeps the system prompt external", async () => {
    const llm = new RecordingClient(async (_request, callIndex) => `answer-${callIndex + 1}`);
    const service = new ConversationService(llm, {
      maxHistoryMessages: 2,
      systemPrompt: "system instruction",
      logger: createLogger(),
    });
    const channelA = new RecordingTransport();
    const channelB = new RecordingTransport();

    await service.handle({ conversationId: "A", prompt: "A-one", transport: channelA });
    await service.handle({ conversationId: "A", prompt: "A-two", transport: channelA });
    await service.handle({ conversationId: "B", prompt: "B-one", transport: channelB });
    await service.handle({ conversationId: "A", prompt: "A-three", transport: channelA });

    expect(llm.requests.map((request) => request.systemPrompt)).toEqual([
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
    expect(channelA.sentMessages).toEqual(["answer-1", "answer-2", "answer-4"]);
    expect(channelB.sentMessages).toEqual(["answer-3"]);
    expect(channelA.typingCount).toBe(3);
    expect(channelB.typingCount).toBe(1);
  });

  it("sends a concise failure reply and does not retain a failed LLM turn", async () => {
    const llm = new RecordingClient(async (_request, callIndex) => {
      if (callIndex === 0) {
        throw new Error("provider unavailable");
      }
      return "recovered";
    });
    const service = new ConversationService(llm, {
      maxHistoryMessages: 20,
      systemPrompt: undefined,
      logger: createLogger(),
    });
    const transport = new RecordingTransport();

    await expect(service.handle({
      conversationId: "channel",
      prompt: "failed prompt",
      transport,
    })).resolves.toBeUndefined();
    await service.handle({
      conversationId: "channel",
      prompt: "next prompt",
      transport,
    });

    expect(transport.sentMessages).toEqual([USER_FAILURE_MESSAGE, "recovered"]);
    expect(llm.requests[1]?.messages).toEqual([message("user", "next prompt")]);
  });

  it("handles a Discord send failure without committing the undelivered turn", async () => {
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
    const service = new ConversationService(llm, {
      maxHistoryMessages: 20,
      systemPrompt: undefined,
      logger: createLogger(),
    });

    await expect(service.handle({
      conversationId: "channel",
      prompt: "not delivered",
      transport: failingTransport,
    })).resolves.toBeUndefined();
    const healthyTransport = new RecordingTransport();
    await service.handle({
      conversationId: "channel",
      prompt: "next prompt",
      transport: healthyTransport,
    });

    expect(failingTransport.attemptedMessages).toEqual(["answer-1", USER_FAILURE_MESSAGE]);
    expect(failingTransport.sentMessages).toEqual([USER_FAILURE_MESSAGE]);
    expect(llm.requests[1]?.messages).toEqual([message("user", "next prompt")]);
    expect(healthyTransport.sentMessages).toEqual(["answer-2"]);
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
      logger: createLogger(),
    });

    await service.handle({ conversationId: "channel", prompt: "prompt", transport });

    expect(transport.typingCount).toBe(1);
    expect(transport.sentMessages).toEqual(["answer"]);
  });

  it("serializes overlapping requests in one conversation and preserves reply order", async () => {
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
    const transport = new RecordingTransport();
    const service = new ConversationService(llm, {
      maxHistoryMessages: 20,
      systemPrompt: undefined,
      logger: createLogger(),
    });

    const first = service.handle({
      conversationId: "channel",
      prompt: "first prompt",
      transport,
    });
    await firstStarted;
    const second = service.handle({
      conversationId: "channel",
      prompt: "second prompt",
      transport,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(llm.requests).toHaveLength(1);
    if (resolveFirstCompletion === undefined) {
      throw new Error("First completion resolver was not initialized.");
    }
    resolveFirstCompletion("first reply");
    await Promise.all([first, second]);

    expect(maximumActiveCalls).toBe(1);
    expect(transport.sentMessages).toEqual(["first reply", "second reply"]);
    expect(llm.requests[1]?.messages).toEqual([
      message("user", "first prompt"),
      message("assistant", "first reply"),
      message("user", "second prompt"),
    ]);
  });
});
