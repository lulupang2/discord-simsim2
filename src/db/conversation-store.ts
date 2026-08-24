import { desc, eq } from "drizzle-orm";
import type {
  ConversationExchange,
  ConversationStore,
} from "../conversation.js";
import type { ChatMessage } from "../llm.js";
import type { Database } from "./client.js";
import { messages } from "./schema.js";

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
}
