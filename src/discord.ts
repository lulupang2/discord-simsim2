import { Events, type Client, type SendableChannels } from "discord.js";
import { type ConversationService, type ConversationTransport } from "./conversation.js";
import { type Logger, summarizeError } from "./logging.js";
import { extractPrompt } from "./trigger.js";

export function attachDiscordMessageHandler(
  client: Client,
  conversations: ConversationService,
  logger: Logger,
): void {
  client.on(Events.MessageCreate, (message) => {
    const botUserId = client.user?.id;
    if (botUserId === undefined) {
      return;
    }

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
      conversationId: message.channelId,
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
    async sendMessage(content: string): Promise<void> {
      await channel.send({
        content,
        allowedMentions: { parse: [] },
      });
    },
  };
}
