import { describe, expect, it, vi } from "vitest";
import { createElysiaServer } from "../src/server/index.js";
import type { BotConfig } from "../src/config.js";
import type { NeonConversationStore } from "../src/db/conversation-store.js";
import type { LlmProviderControl } from "../src/llm.js";
import type { ConversationService } from "../src/conversation.js";
import {
  FileSettingsStore,
  SettingsPresetsStore,
  type BotSettings,
} from "../src/llm-settings.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  const mockLlm = {
    stream: vi.fn().mockResolvedValue("테스트 응답"),
    getProviderSettings: vi.fn().mockReturnValue({
      baseUrl: "https://api.tokenrouter.com/v1",
      apiKey: "test-key-12345678",
      model: "qwen/qwen3.8-max-free",
      maxTokens: 300,
      enableThinking: true,
    }),
    updateProviderSettings: vi.fn(),
    testConnection: vi.fn().mockResolvedValue(undefined),
  };

  const mockClient = {
    isReady: vi.fn().mockReturnValue(true),
    user: { tag: "답장#3860" },
  } as unknown as Client;

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  const settingsStore = new FileSettingsStore(join(tmpdir(), `simsim-settings-test-${process.pid}.json`));
  const presetsStore = new SettingsPresetsStore(join(tmpdir(), `simsim-presets-test-${process.pid}.json`));
  const defaultSettings: BotSettings = {
    baseUrl: "https://api.tokenrouter.com/v1",
    apiKey: "env-key-12345678",
    model: "qwen/qwen3.8-max-free",
    maxTokens: 300,
    enableThinking: true,
    systemPrompt: "system prompt",
  };
  const mockConversations = {
    setSystemPrompt: vi.fn(),
    systemPrompt: "system prompt",
  } as unknown as ConversationService;
  const app = createElysiaServer({
    port: 3000,
    config: mockConfig,
    store: mockStore,
    llm: mockLlm as unknown as LlmProviderControl,
    conversations: mockConversations,
    settingsStore,
    presetsStore,
    defaultSettings,
    client: mockClient,
    logger: mockLogger,
  });

  it("serves HTML dashboard on /", async () => {
    const res = await app.handle(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Dapjang Admin");
    expect(html).toContain("답장");
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

  it("returns current settings with masked api key on GET /api/settings", async () => {
    const res = await app.handle(new Request("http://localhost/api/settings"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("env");
    expect(data.baseUrl).toBe("https://api.tokenrouter.com/v1");
    expect(data.model).toBe("qwen/qwen3.8-max-free");
    expect(data.apiKeyMasked).not.toContain("test-key");
    expect(data.apiKeyMasked).toContain("…");
  });

  it("tests the connection and saves on PUT /api/settings", async () => {
    mockLlm.updateProviderSettings.mockClear();
    mockLlm.testConnection.mockClear();
    const res = await app.handle(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: "https://api.other-provider.example/v1",
          apiKey: "sk-new-key-987654321",
          model: "gpt-test",
          maxTokens: 512,
          systemPrompt: "너는 답장이야.",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.settings.model).toBe("gpt-test");
    expect(mockLlm.testConnection).toHaveBeenCalled();
    expect(mockLlm.updateProviderSettings).toHaveBeenCalledTimes(1);
    expect(mockConversations.setSystemPrompt).toHaveBeenCalledWith("너는 답장이야.");
    const saved = await settingsStore.load();
    expect(saved?.model).toBe("gpt-test");
  });

  it("reverts provider settings and saves nothing when the connection test fails", async () => {
    mockLlm.updateProviderSettings.mockClear();
    mockLlm.testConnection.mockClear();
    mockLlm.testConnection.mockRejectedValueOnce(new Error("HTTP 401"));
    const res = await app.handle(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-bad-key-000000000", model: "broken-model" }),
      }),
    );
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("LLM 연결 테스트 실패");
    expect(mockLlm.updateProviderSettings).toHaveBeenCalledTimes(2);
    expect(mockConversations.setSystemPrompt).not.toHaveBeenCalledWith(expect.stringContaining("broken"));
    await expect(settingsStore.load()).resolves.toMatchObject({ model: "gpt-test" });
  });
  it("rejects invalid settings with 400 before touching the provider", async () => {
    mockLlm.testConnection.mockClear();
    const res = await app.handle(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: "not-a-url" }),
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("baseUrl");
    expect(mockLlm.testConnection).not.toHaveBeenCalled();
  });

  it("saves a preset and lists it with a masked api key", async () => {
    const put = await app.handle(
      new Request(`http://localhost/api/settings/presets/${encodeURIComponent("내 프리셋")}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: "https://api.preset.example/v1",
          apiKey: "sk-preset-key-123456",
          model: "preset-model",
          maxTokens: 1024,
          enableThinking: false,
          systemPrompt: "프리셋 프롬프트",
        }),
      }),
    );
    expect(put.status).toBe(200);
    expect((await put.json())).toMatchObject({ ok: true, name: "내 프리셋" });

    const list = await app.handle(new Request("http://localhost/api/settings/presets"));
    expect(list.status).toBe(200);
    const listData = await list.json();
    const found = listData.presets.find((preset: { name: string }) => preset.name === "내 프리셋");
    expect(found).toMatchObject({
      baseUrl: "https://api.preset.example/v1",
      model: "preset-model",
      maxTokens: 1024,
      enableThinking: false,
      systemPrompt: "프리셋 프롬프트",
    });
    expect(found.apiKeyMasked).toContain("…");
  });

  it("applies a preset after a successful connection test and persists it as active", async () => {
    mockLlm.updateProviderSettings.mockClear();
    const res = await app.handle(
      new Request(`http://localhost/api/settings/presets/${encodeURIComponent("내 프리셋")}/apply`, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.settings.model).toBe("preset-model");
    expect(mockLlm.updateProviderSettings).toHaveBeenCalledTimes(1);
    expect(mockConversations.setSystemPrompt).toHaveBeenCalledWith("프리셋 프롬프트");
    await expect(settingsStore.load()).resolves.toMatchObject({ model: "preset-model" });
  });

  it("reverts provider settings when a preset fails the connection test", async () => {
    mockLlm.updateProviderSettings.mockClear();
    mockLlm.testConnection.mockRejectedValueOnce(new Error("HTTP 503"));
    const res = await app.handle(
      new Request(`http://localhost/api/settings/presets/${encodeURIComponent("내 프리셋")}/apply`, { method: "POST" }),
    );
    expect(res.status).toBe(502);
    expect(mockLlm.updateProviderSettings).toHaveBeenCalledTimes(2);
    await expect(settingsStore.load()).resolves.toMatchObject({ model: "preset-model" });
  });

  it("returns 404 when applying or deleting a missing preset", async () => {
    const applied = await app.handle(
      new Request("http://localhost/api/settings/presets/missing-preset/apply", { method: "POST" }),
    );
    expect(applied.status).toBe(404);
    const deleted = await app.handle(
      new Request("http://localhost/api/settings/presets/missing-preset", { method: "DELETE" }),
    );
    expect(deleted.status).toBe(404);
  });

  it("deletes an existing preset exactly once", async () => {
    const url = `http://localhost/api/settings/presets/${encodeURIComponent("내 프리셋")}`;
    const deleted = await app.handle(new Request(url, { method: "DELETE" }));
    expect(deleted.status).toBe(200);
    const list = await app.handle(new Request("http://localhost/api/settings/presets"));
    const listData = await list.json();
    expect(listData.presets.find((preset: { name: string }) => preset.name === "내 프리셋")).toBeUndefined();
  });

  it("rejects a blank preset name with 400", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/settings/presets/%20%20", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});
