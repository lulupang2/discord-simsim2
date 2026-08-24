import { Client, GatewayIntentBits, type TextChannel } from "discord.js";
import { createDatabaseConnection } from "../db/client.js";
import { NeonConversationStore } from "../db/conversation-store.js";
import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const channelId = process.argv[2];
  const limit = Number(process.argv[3] ?? "200");

  if (!channelId) {
    console.error("Usage: npm run ingest-channel <channelId> [limit]");
    process.exit(1);
  }

  try {
    process.loadEnvFile?.();
  } catch {
    // ignore
  }

  const config = loadConfig();
  console.log(`Connecting to Neon Database...`);
  const database = createDatabaseConnection(config.databaseUrl);
  await database.ping();
  const store = new NeonConversationStore(database.db);

  console.log(`Logging into Discord...`);
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  await client.login(config.discordToken);
  console.log(`Logged in as ${client.user?.tag}`);

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !("messages" in channel)) {
      throw new Error(`Channel ${channelId} not found or is not a text channel.`);
    }

    const textChannel = channel as TextChannel;
    console.log(`Fetching up to ${limit} messages from #${textChannel.name}...`);

    let lastId: string | undefined;
    const collected: Array<{
      channelId: string;
      guildId?: string | null;
      authorId: string;
      role: "user" | "assistant";
      content: string;
      createdAt: Date;
    }> = [];

    while (collected.length < limit) {
      const fetchLimit = Math.min(100, limit - collected.length);
      const messages = await textChannel.messages.fetch(
        lastId !== undefined ? { limit: fetchLimit, before: lastId } : { limit: fetchLimit },
      );

      if (messages.size === 0) {
        break;
      }

      for (const [, msg] of messages) {
        if (!msg.content || msg.content.trim().length === 0) {
          continue;
        }

        const isBot = msg.author.bot;
        collected.push({
          channelId: msg.channelId,
          guildId: msg.guildId,
          authorId: msg.author.id,
          role: isBot ? "assistant" : "user",
          content: msg.content,
          createdAt: msg.createdAt,
        });
      }

      lastId = messages.last()?.id;
    }

    // Ingest into Neon DB in chronological order
    collected.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    console.log(`Ingesting ${collected.length} messages into Neon DB...`);

    const insertedCount = await store.ingestRawMessages(collected);
    console.log(`✅ ${insertedCount}개 대화 메시지 인제스트 및 RAG 색인 완료!`);
  } finally {
    client.destroy();
  }
}

void main().catch((error) => {
  console.error("Channel ingestion failed:", error);
  process.exit(1);
});
