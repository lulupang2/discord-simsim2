import { Events, type Client, type SendableChannels } from "discord.js";
import { type ConversationService, type ConversationTransport } from "./conversation.js";
import type { NeonConversationStore } from "./db/conversation-store.js";
import { type Logger, summarizeError } from "./logging.js";
import { extractPrompt } from "./trigger.js";

export function attachDiscordMessageHandler(
  client: Client,
  conversations: ConversationService,
  logger: Logger,
  store?: NeonConversationStore,
): void {
  client.on(Events.MessageCreate, async (message) => {
    const botUserId = client.user?.id;
    if (botUserId === undefined || message.author.bot) {
      return;
    }

    const trimmed = message.content.trim();

    // 1. 학습 통계 명령어 (!학습통계 / !대화통계 / !데이터셋)
    if (trimmed === "!학습통계" || trimmed === "!대화통계" || trimmed === "!데이터셋") {
      if (!message.channel.isSendable() || !store) {
        return;
      }
      try {
        const stats = await store.getStatistics();
        const response = [
          "📊 **Neon DB 대화 데이터셋 & 학습 통계**",
          "```yaml",
          `총 누적 메시지: ${stats.totalMessages.toLocaleString()} 건`,
          `사용자 질문: ${stats.userMessages.toLocaleString()} 건`,
          `어시스턴트 답변: ${stats.assistantMessages.toLocaleString()} 건`,
          `활성 채널 수: ${stats.channelCount.toLocaleString()} 개`,
          `최초 대화 일시: ${stats.earliestMessage ? new Date(stats.earliestMessage as string | number | Date).toLocaleString("ko-KR") : "없음"}`,
          `최근 대화 일시: ${stats.latestMessage ? new Date(stats.latestMessage as string | number | Date).toLocaleString("ko-KR") : "없음"}`,
          "```",
          "💡 `npm run export-dataset` 명령어로 OpenAI/Qwen 파인튜닝용 JSONL을 추출할 수 있습니다.",
        ].join("\n");
        await message.channel.send({ content: response });
      } catch (err) {
        logger.error("Failed to fetch statistics", { error: summarizeError(err) });
      }
      return;
    }

    // 2. 과거 기억/지식 검색 명령어 (!기억 <키워드> / !검색 <키워드>)
    if (trimmed.startsWith("!기억 ") || trimmed.startsWith("!검색 ")) {
      if (!message.channel.isSendable() || !store) {
        return;
      }
      const query = trimmed.replace(/^!(기억|검색)\s+/, "").trim();
      if (query.length === 0) {
        await message.channel.send({ content: "검색할 키워드를 입력해주세요. (예: `!기억 날씨`)" });
        return;
      }
      try {
        const results = await store.findRelevant(query, { channelId: message.channelId, limit: 5 });
        if (results.length === 0) {
          await message.channel.send({ content: `🔍 **'${query}'** 에 대한 과거 기억/대화 기록이 없습니다.` });
          return;
        }
        const formatted = results
          .map((r, idx) => `${idx + 1}. **[${r.role === "user" ? "사용자" : "어시스턴트"}]** ${r.content}`)
          .join("\n\n");
        await message.channel.send({
          content: `🔍 **'${query}' 관련 과거 대화 검색 결과 (${results.length}건):**\n\n${formatted}`,
        });
      } catch (err) {
        logger.error("Failed to search relevant memories", { error: summarizeError(err) });
      }
      return;
    }

    // 3. 일반 대화 처리 (멘션 또는 DM) - 완전 비동기 병렬 실행
    const prompt = extractPrompt({
      content: message.content,
      authorIsBot: message.author.bot,
      isWebhook: message.webhookId !== null,
      isDirectMessage: !message.inGuild(),
      botUserId,
    });
    if (prompt === null) {
      return;
    }
    if (!message.channel.isSendable()) {
      logger.warn("Accepted Discord message came from a non-sendable channel.", {
        conversationId: message.channelId,
      });
      return;
    }

    const transport = createTransport(message.channel);
    void conversations.handle({
      channelId: message.channelId,
      guildId: message.guildId,
      userId: message.author.id,
      botUserId,
      prompt,
      transport,
    }).catch((error: unknown) => {
      logger.error("Discord message handler failed unexpectedly.", {
        conversationId: message.channelId,
        error: summarizeError(error),
      });
    });
  });
}

function createTransport(channel: SendableChannels): ConversationTransport {
  return {
    async sendTyping(): Promise<void> {
      await channel.sendTyping();
    },
    async sendInitial(content: string) {
      const message = await channel.send({
        content,
        allowedMentions: { parse: [] },
      });
      return {
        async edit(updatedContent: string): Promise<void> {
          await message.edit({
            content: updatedContent,
            allowedMentions: { parse: [] },
          });
        },
      };
    },
    async sendFinalChunk(content: string): Promise<void> {
      await channel.send({
        content,
        allowedMentions: { parse: [] },
      });
    },
    async sendFailureNotice(content: string): Promise<void> {
      await channel.send({
        content,
        allowedMentions: { parse: [] },
      });
    },
  };
}
