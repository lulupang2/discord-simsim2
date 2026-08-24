import { describe, expect, it, vi } from "vitest";
import { createElysiaServer } from "../src/server/index.js";
import type { BotConfig } from "../src/config.js";
import type { NeonConversationStore } from "../src/db/conversation-store.js";
import type { LlmStreamClient } from "../src/llm.js";
import type { Client } from "discord.js";
import type { Logger } from "../src/logging.js";

describe("Elysia Admin Server", () => {
  const mockConfig: BotConfig = {
    discordToken: "token",
    llmApiKey: "key",
    llmModel: "qwen/qwen3.8-max-free",
    llmBaseUrl: "https://api.tokenrouter.com/v1",
    databaseUrl: "postgresql://localhost/db",
    systemPrompt: "system prompt",
    maxHistoryMessages: 20,
    llmMaxTokens: 300,
    port: 3000,
  };

  const mockStore = {
    getStatistics: vi.fn().mockResolvedValue({
      totalMessages: 100,
      userMessages: 50,
      assistantMessages: 50,
      channelCount: 2,
      earliestMessage: new Date("2026-08-24T00:00:00Z"),
      latestMessage: new Date("2026-08-25T00:00:00Z"),
    }),
    listMessages: vi.fn().mockResolvedValue({
      items: [
        {
          id: 1,
          channelId: "c1",
          guildId: "g1",
          authorId: "u1",
          role: "user",
          content: "테스트 질문",
          createdAt: new Date(),
        },
      ],
      total: 1,
    }),
    listLogs: vi.fn().mockResolvedValue({
      items: [],
      total: 0,
    }),
    exportDataset: vi.fn().mockResolvedValue([
      { messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }] },
    ]),
    findRelevant: vi.fn().mockResolvedValue([]),
  } as unknown as NeonConversationStore;

  const mockLlm: LlmStreamClient = {
    stream: vi.fn().mockResolvedValue("테스트 응답"),
  };

  const mockClient = {
    isReady: vi.fn().mockReturnValue(true),
    user: { tag: "안내견#3860" },
  } as unknown as Client;

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  const app = createElysiaServer({
    port: 3000,
    config: mockConfig,
    store: mockStore,
    llm: mockLlm,
    client: mockClient,
    logger: mockLogger,
  });

  it("serves HTML dashboard on /", async () => {
    const res = await app.handle(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("GuideDog Admin");
    expect(html).toContain("안내견");
  });

  it("returns health status on /health", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.botStatus).toBe("online");
    expect(data.model).toBe("qwen/qwen3.8-max-free");
  });

  it("returns statistics on /api/stats", async () => {
    const res = await app.handle(new Request("http://localhost/api/stats"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalMessages).toBe(100);
    expect(data.userMessages).toBe(50);
  });

  it("returns message list on /api/messages", async () => {
    const res = await app.handle(new Request("http://localhost/api/messages?limit=10"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.items).toHaveLength(1);
  });

  it("exports dataset as JSONL file on /api/dataset/export", async () => {
    const res = await app.handle(new Request("http://localhost/api/dataset/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-jsonlines");
    const body = await res.text();
    expect(body).toContain('"role":"system"');
  });

  it("handles interactive test chat on POST /api/test-chat", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/test-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "안녕?" }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply).toBe("테스트 응답");
  });
});
