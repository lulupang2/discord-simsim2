import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { loadConfig, ConfigurationError, type BotConfig } from "./config.js";
import { ConversationService } from "./conversation.js";
import { attachDiscordMessageHandler } from "./discord.js";
import { OpenAICompatibleClient } from "./llm.js";
import { consoleLogger, summarizeError } from "./logging.js";

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

  const llm = new OpenAICompatibleClient({
    apiKey: config.llmApiKey,
    model: config.llmModel,
    baseUrl: config.llmBaseUrl,
  });
  const conversations = new ConversationService(llm, {
    maxHistoryMessages: config.maxHistoryMessages,
    systemPrompt: config.systemPrompt,
    logger: consoleLogger,
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

  attachDiscordMessageHandler(client, conversations, consoleLogger);
  client.once(Events.ClientReady, (readyClient) => {
    consoleLogger.info("Discord bot is ready.", {
      user: readyClient.user.tag,
    });
  });
  client.on(Events.Error, (error) => {
    consoleLogger.error("Discord client error.", {
      error: summarizeError(error),
    });
  });
  client.on(Events.Warn, (warning) => {
    consoleLogger.warn("Discord client warning.", {
      warning: warning.slice(0, 500),
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: "SIGINT" | "SIGTERM"): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    consoleLogger.info("Shutdown signal received; closing Discord connection.", { signal });
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
      consoleLogger.error(
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
