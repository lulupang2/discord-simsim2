import { describe, expect, it, vi } from "vitest";
import {
  ConversationService,
  SPEAKER_NOTE,
  USER_FAILURE_MESSAGE,
  type ConversationExchange,
  type ConversationRequest,
  type ConversationStore,
  type ConversationTransport,
  type HistoryTurn,
} from "../src/conversation.js";
import type { UserChatStyle } from "../src/chat-style.js";
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
  readonly #messages = new Map<string, HistoryTurn[]>();
  relevantResults: Array<{
    role: "user" | "assistant";
    content: string;
    authorName?: string | null;
  }> = [];
  userChatStyle: UserChatStyle | undefined;
  constructor(
    private readonly failReads = false,
    private readonly failWrites = false,
  ) {}

  async findRelevant(_query: string): Promise<readonly {
    role: "user" | "assistant";
    content: string;
    authorName?: string | null;
  }[]> {
    return this.relevantResults;
  }
  async getRecent(channelId: string, limit: number): Promise<readonly HistoryTurn[]> {
    if (this.failReads) {
      throw new Error("database read unavailable");
    }
    return (this.#messages.get(channelId) ?? [])
      .slice(-limit)
      .map((entry) => ({ ...entry }));
  }

  async getUserChatStyle(): Promise<UserChatStyle | undefined> {
    return this.userChatStyle;
  }

  async appendExchange(exchange: ConversationExchange): Promise<void> {
    if (this.failWrites) {
      throw new Error("database write unavailable");
    }

    this.exchanges.push({ ...exchange });
    const messages = this.#messages.get(exchange.channelId) ?? [];
    this.#messages.set(exchange.channelId, [
      ...messages,
      { role: "user", content: exchange.userMessage, authorName: exchange.userDisplayName },
      { role: "assistant", content: exchange.assistantMessage },
    ]);
  }

  getAll(channelId: string): readonly HistoryTurn[] {
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
    userDisplayName: "테스터",
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
      `system instruction\n\n${SPEAKER_NOTE}`,
      `system instruction\n\n${SPEAKER_NOTE}`,
      `system instruction\n\n${SPEAKER_NOTE}`,
      `system instruction\n\n${SPEAKER_NOTE}`,
    ]);
    expect(llm.requests[0]?.messages).toEqual([message("user", "테스터: A-one")]);
    expect(llm.requests[1]?.messages).toEqual([
      message("user", "테스터: A-one"),
      message("assistant", "answer-1"),
      message("user", "테스터: A-two"),
    ]);
    expect(llm.requests[2]?.messages).toEqual([message("user", "테스터: B-one")]);
    expect(llm.requests[3]?.messages).toEqual([
      message("user", "테스터: A-two"),
      message("assistant", "answer-2"),
      message("user", "테스터: A-three"),
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
    expect(llm.requests[1]?.messages).toEqual([message("user", "테스터: next prompt")]);
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
    expect(llm.requests[1]?.messages).toEqual([message("user", "테스터: next prompt")]);
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

  it("processes overlapping requests concurrently and in parallel", async () => {
    let resolveFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    let resolveSecondStarted: (() => void) | undefined;
    const secondStarted = new Promise<void>((resolve) => {
      resolveSecondStarted = resolve;
    });
    let resolveCompletions: (() => void) | undefined;
    const completions = new Promise<void>((resolve) => {
      resolveCompletions = resolve;
    });

    let activeCalls = 0;
    let maximumActiveCalls = 0;
    const llm = new RecordingClient(async (_request, callIndex) => {
      activeCalls += 1;
      maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
      if (callIndex === 0) {
        resolveFirstStarted?.();
      } else {
        resolveSecondStarted?.();
      }
      await completions;
      activeCalls -= 1;
      return callIndex === 0 ? "first reply" : "second reply";
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
    await secondStarted;

    expect(maximumActiveCalls).toBe(2);
    resolveCompletions?.();
    await Promise.all([first, second]);

    expect(llm.requests).toHaveLength(2);
  });

  it("enriches the system prompt with relevant past context when available", async () => {
    const llm = new RecordingClient(async () => "contextual answer");
    const store = new RecordingStore();
    store.relevantResults = [
      { role: "user", content: "우리 집 강아지 이름은 멍멍이야", authorName: "과거의철수" },
      { role: "assistant", content: "기억해둘게요!" },
    ];
    const transport = new RecordingTransport();
    const service = new ConversationService(llm, {
      maxHistoryMessages: 20,
      systemPrompt: "기본 시스템 프롬프트",
      store,
      logger: createLogger(),
    });

    await service.handle(request("channel", "강아지 이름이 뭐였지?", transport));

    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]?.systemPrompt).toContain("기본 시스템 프롬프트");
    expect(llm.requests[0]?.systemPrompt).toContain("[과거 기록] 과거의철수: 우리 집 강아지 이름은 멍멍이야");
    expect(llm.requests[0]?.systemPrompt).toContain("[과거 기록] 어시스턴트: 기억해둘게요!");
  });

  it("adds a current user's analyzed chat style to the system prompt", async () => {
    const llm = new RecordingClient(async () => "맞춤 답변");
    const store = new RecordingStore();
    store.userChatStyle = {
      sampleSize: 12,
      averageCharacters: 14,
      speechLevel: "casual",
      messageLength: "short",
      questionRate: 50,
      exclamationRate: 25,
      emojiRate: 0,
      frequentMarkers: ["ㅋㅋ", "ㅇㅇ"],
    };
    const service = new ConversationService(llm, {
      maxHistoryMessages: 20,
      systemPrompt: "기본 시스템 프롬프트",
      store,
      logger: createLogger(),
    });

    await service.handle(request("channel", "뭐함", new RecordingTransport()));

    expect(llm.requests[0]?.systemPrompt).toContain("[현재 사용자 채팅 스타일 참고]");
    expect(llm.requests[0]?.systemPrompt).toContain("분석 표본: 최근 12개 발화");
    expect(llm.requests[0]?.systemPrompt).toContain("반말 중심");
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

  it("attributes each user turn with its display name so speakers stay distinguishable", async () => {
    const llm = new RecordingClient(async (_request, callIndex) => `answer-${callIndex + 1}`);
    const store = new RecordingStore();
    const service = new ConversationService(llm, {
      maxHistoryMessages: 10,
      systemPrompt: undefined,
      store,
      logger: createLogger(),
    });
    const transport = new RecordingTransport();

    await service.handle({ ...request("channel", "안녕", transport), userDisplayName: "철수" });
    await service.handle({ ...request("channel", "또 안녕", transport), userDisplayName: "영희" });
    await service.handle({ ...request("channel2", "야", transport), userDisplayName: "   " });

    expect(llm.requests[0]?.messages).toEqual([message("user", "철수: 안녕")]);
    expect(llm.requests[1]?.messages).toEqual([
      message("user", "철수: 안녕"),
      message("assistant", "answer-1"),
      message("user", "영희: 또 안녕"),
    ]);
    expect(llm.requests[2]?.messages).toEqual([message("user", "사용자: 야")]);
    expect(store.getAll("channel")).toEqual([
      { role: "user", content: "안녕", authorName: "철수" },
      { role: "assistant", content: "answer-1" },
      { role: "user", content: "또 안녕", authorName: "영희" },
      { role: "assistant", content: "answer-2" },
    ]);
  });

  it("includes image attachment URLs in the user message when provided", async () => {
    const llm = new RecordingClient(async () => "이미지 분석 완료");
    const store = new RecordingStore();
    const service = new ConversationService(llm, {
      maxHistoryMessages: 10,
      systemPrompt: undefined,
      store,
      logger: createLogger(),
    });
    const transport = new RecordingTransport();

    await service.handle({
      ...request("channel", "이 사진 뭐야?", transport),
      userDisplayName: "민수",
      imageUrls: ["https://cdn.discordapp.com/attachments/123/photo.png"],
    });

    expect(llm.requests[0]?.messages).toEqual([{
      role: "user",
      content: [
        { type: "text", text: "민수: 이 사진 뭐야?" },
        { type: "image_url", image_url: { url: "https://cdn.discordapp.com/attachments/123/photo.png" } },
      ],
    }]);
  });
});
