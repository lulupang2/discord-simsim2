import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import type {
  ConversationExchange,
  ConversationStore,
  RelevantContext,
} from "../conversation.js";
import type { ChatMessage } from "../llm.js";
import type { Database } from "./client.js";
import { botLogs, messages } from "./schema.js";

export interface FineTuningSample {
  readonly messages: readonly {
    readonly role: "system" | "user" | "assistant";
    readonly content: string;
  }[];
}

export interface ConversationStats {
  readonly totalMessages: number;
  readonly userMessages: number;
  readonly assistantMessages: number;
  readonly channelCount: number;
  readonly earliestMessage: Date | null;
  readonly latestMessage: Date | null;
}

export class NeonConversationStore implements ConversationStore {
  public constructor(private readonly db: Database) {}

  public async getRecent(
    channelId: string,
    limit: number,
  ): Promise<readonly ChatMessage[]> {
    const rows = await this.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.channelId, channelId))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit);

    return rows.reverse();
  }

  public async appendExchange(exchange: ConversationExchange): Promise<void> {
    await this.db.insert(messages).values([
      {
        channelId: exchange.channelId,
        guildId: exchange.guildId,
        authorId: exchange.userId,
        role: "user",
        content: exchange.userMessage,
      },
      {
        channelId: exchange.channelId,
        guildId: exchange.guildId,
        authorId: exchange.botUserId,
        role: "assistant",
        content: exchange.assistantMessage,
      },
    ]);
  }

  public async findRelevant(
    query: string,
    options?: { channelId?: string; limit?: number },
  ): Promise<readonly RelevantContext[]> {
    const limit = options?.limit ?? 3;
    const keywords = extractKeywords(query);
    if (keywords.length === 0) {
      return [];
    }

    const keywordConditions = keywords.map((kw) => ilike(messages.content, `%${kw}%`));
    const searchFilter = keywordConditions.length === 1 ? keywordConditions[0] : or(...keywordConditions);

    const whereClause = options?.channelId
      ? and(eq(messages.channelId, options.channelId), searchFilter)
      : searchFilter;

    const rows = await this.db
      .select({
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(whereClause)
      .orderBy(desc(messages.createdAt))
      .limit(limit * 2);

    // Exclude exact matches that are just repeating the query itself
    const filtered = rows.filter((r) => r.content.trim() !== query.trim());
    return filtered.slice(0, limit);
  }

  public async exportDataset(options?: {
    channelId?: string;
    systemPrompt?: string;
  }): Promise<readonly FineTuningSample[]> {
    const whereClause = options?.channelId ? eq(messages.channelId, options.channelId) : undefined;

    const rows = await this.db
      .select({
        channelId: messages.channelId,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(whereClause)
      .orderBy(asc(messages.channelId), asc(messages.createdAt), asc(messages.id));

    const samples: FineTuningSample[] = [];
    const groupedByChannel = new Map<string, typeof rows>();

    for (const row of rows) {
      const channelRows = groupedByChannel.get(row.channelId) ?? [];
      channelRows.push(row);
      groupedByChannel.set(row.channelId, channelRows);
    }

    const defaultSystem = options?.systemPrompt ?? "너는 디스코드 대화형 어시스턴트 봇 안내견이야.";

    for (const [, channelRows] of groupedByChannel) {
      let currentSampleMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: defaultSystem },
      ];

      for (const row of channelRows) {
        currentSampleMessages.push({
          role: row.role,
          content: row.content,
        });

        // Whenever we complete an assistant response or hit length threshold, finalize a training turn
        if (row.role === "assistant" && currentSampleMessages.length >= 3) {
          samples.push({
            messages: [...currentSampleMessages],
          });
          // If conversation is very long (> 10 turns), start fresh window to keep sample sizes optimal
          if (currentSampleMessages.length > 15) {
            currentSampleMessages = [{ role: "system", content: defaultSystem }];
          }
        }
      }
    }

    return samples;
  }

  public async ingestRawMessages(
    rawMessages: Array<{
      channelId: string;
      guildId?: string | null;
      authorId: string;
      role: "user" | "assistant";
      content: string;
      createdAt?: Date;
    }>,
  ): Promise<number> {
    if (rawMessages.length === 0) {
      return 0;
    }

    const BATCH_SIZE = 50;
    let inserted = 0;

    for (let i = 0; i < rawMessages.length; i += BATCH_SIZE) {
      const batch = rawMessages.slice(i, i + BATCH_SIZE);
      await this.db.insert(messages).values(
        batch.map((m) => ({
          channelId: m.channelId,
          guildId: m.guildId ?? null,
          authorId: m.authorId,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt ?? new Date(),
        })),
      );
      inserted += batch.length;
    }

    return inserted;
  }

  public async getStatistics(): Promise<ConversationStats> {
    const [totalRow] = await this.db.select({ count: count() }).from(messages);
    const [userRow] = await this.db
      .select({ count: count() })
      .from(messages)
      .where(eq(messages.role, "user"));
    const [assistantRow] = await this.db
      .select({ count: count() })
      .from(messages)
      .where(eq(messages.role, "assistant"));

    const [rangeRow] = await this.db.select({
      earliest: sql<Date | null>`min(${messages.createdAt})`,
      latest: sql<Date | null>`max(${messages.createdAt})`,
      channelCount: sql<number>`count(distinct ${messages.channelId})`,
    }).from(messages);

    return {
      totalMessages: Number(totalRow?.count ?? 0),
      userMessages: Number(userRow?.count ?? 0),
      assistantMessages: Number(assistantRow?.count ?? 0),
      channelCount: Number(rangeRow?.channelCount ?? 0),
      earliestMessage: rangeRow?.earliest ?? null,
      latestMessage: rangeRow?.latest ?? null,
    };
  }
  public async listMessages(options?: {
    channelId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: typeof messages.$inferSelect[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const whereClause = options?.channelId ? eq(messages.channelId, options.channelId) : undefined;

    const [countResult] = await this.db.select({ count: count() }).from(messages).where(whereClause);
    const total = Number(countResult?.count ?? 0);

    const items = await this.db
      .select()
      .from(messages)
      .where(whereClause)
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit)
      .offset(offset);

    return { items, total };
  }

  public async listLogs(options?: {
    level?: "info" | "warn" | "error";
    limit?: number;
    offset?: number;
  }): Promise<{ items: typeof botLogs.$inferSelect[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const whereClause = options?.level ? eq(botLogs.level, options.level) : undefined;

    const [countResult] = await this.db.select({ count: count() }).from(botLogs).where(whereClause);
    const total = Number(countResult?.count ?? 0);

    const items = await this.db
      .select()
      .from(botLogs)
      .where(whereClause)
      .orderBy(desc(botLogs.createdAt), desc(botLogs.id))
      .limit(limit)
      .offset(offset);

    return { items, total };
  }
}

function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    "이", "그", "저", "것", "수", "등", "및", "를", "을", "가", "이", "은", "는", "에", "의", "로", "으로",
    "에서", "에게", "한테", "과", "와", "도", "만", "봇", "안내견", "디스코드", "질문", "답변", "알려줘",
    "해줘", "말해줘", "뭐야", "어떻게", "언제", "어디", "누구", "왜", "test", "please", "the", "a", "an", "is",
  ]);

  return query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !stopWords.has(w.toLowerCase()))
    .slice(0, 5);
}
