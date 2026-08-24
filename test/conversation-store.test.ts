import { describe, expect, it, vi } from "vitest";
import { NeonConversationStore } from "../src/db/conversation-store.js";
import type { Database } from "../src/db/client.js";

describe("NeonConversationStore", () => {
  it("formats conversation turns into standard fine-tuning dataset samples", async () => {
    const mockRows = [
      {
        channelId: "channel-1",
        role: "user" as const,
        content: "안녕?",
        createdAt: new Date("2026-08-25T01:00:00Z"),
      },
      {
        channelId: "channel-1",
        role: "assistant" as const,
        content: "안녕하세요! 무엇을 도와드릴까요?",
        createdAt: new Date("2026-08-25T01:00:05Z"),
      },
      {
        channelId: "channel-1",
        role: "user" as const,
        content: "오늘 날씨 어때?",
        createdAt: new Date("2026-08-25T01:01:00Z"),
      },
      {
        channelId: "channel-1",
        role: "assistant" as const,
        content: "오늘은 맑고 화창해요.",
        createdAt: new Date("2026-08-25T01:01:05Z"),
      },
    ];

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(mockRows),
          }),
          orderBy: vi.fn().mockResolvedValue(mockRows),
        }),
      }),
    } as unknown as Database;

    const store = new NeonConversationStore(mockDb);
    const samples = await store.exportDataset({
      systemPrompt: "친절한 봇 시스템 프롬프트",
    });

    expect(samples.length).toBeGreaterThanOrEqual(1);
    expect(samples[0]?.messages[0]?.role).toBe("system");
    expect(samples[0]?.messages[0]?.content).toBe("친절한 봇 시스템 프롬프트");
    expect(samples[0]?.messages[1]?.role).toBe("user");
    expect(samples[0]?.messages[1]?.content).toBe("안녕?");
    expect(samples[0]?.messages[2]?.role).toBe("assistant");
    expect(samples[0]?.messages[2]?.content).toBe("안녕하세요! 무엇을 도와드릴까요?");
  });
});
