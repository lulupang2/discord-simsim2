import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { loadConfig, ConfigurationError, type BotConfig } from "./config.js";
import { ConversationService } from "./conversation.js";
import { createDatabaseConnection } from "./db/client.js";
import { NeonConversationStore } from "./db/conversation-store.js";
import { NeonLogSink } from "./db/log-sink.js";
import { attachDiscordMessageHandler } from "./discord.js";
import { OpenAICompatibleClient } from "./llm.js";
import { consoleLogger, createLogger, summarizeError } from "./logging.js";

async function main(): Promise<void> {
  let config: BotConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      consoleLogger.error(error.message);
    } else {
      consoleLogger.error("Configuration could not be loaded.", {
        error: summarizeError(error),
      });
    }
    process.exitCode = 1;
    return;
  }

  const database = createDatabaseConnection(config.databaseUrl);
  try {
    await database.ping();
  } catch (error) {
    consoleLogger.error("Neon database connection failed.", {
      error: summarizeError(error),
    });
    process.exitCode = 1;
    return;
  }

  const logger = createLogger(new NeonLogSink(database.db));
  const conversationStore = new NeonConversationStore(database.db);
  logger.info("Neon database connection is ready.");

  const llm = new OpenAICompatibleClient({
    apiKey: config.llmApiKey,
    model: config.llmModel,
    baseUrl: config.llmBaseUrl,
  });
  const conversations = new ConversationService(llm, {
    maxHistoryMessages: config.maxHistoryMessages,
    systemPrompt: config.systemPrompt,
    store: conversationStore,
    logger,
  });
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  attachDiscordMessageHandler(client, conversations, logger, conversationStore);
  client.once(Events.ClientReady, (readyClient) => {
    logger.info("Discord bot is ready.", {
      user: readyClient.user.tag,
    });
  });
  client.on(Events.Error, (error) => {
    logger.error("Discord client error.", {
      error: summarizeError(error),
    });
  });
  client.on(Events.Warn, (warning) => {
    logger.warn("Discord client warning.", {
      warning: warning.slice(0, 500),
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: "SIGINT" | "SIGTERM"): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info("Shutdown signal received; closing Discord connection.", { signal });
    client.destroy();
  };
  process.once("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  try {
    await client.login(config.discordToken);
  } catch {
    if (!shuttingDown) {
      logger.error(
        "Discord login failed. Check DISCORD_TOKEN, enabled intents, and network access.",
      );
      process.exitCode = 1;
    }
    client.destroy();
  }
}

void main().catch((error: unknown) => {
  consoleLogger.error("Fatal bot startup failure.", {
    error: summarizeError(error),
  });
  process.exitCode = 1;
});
