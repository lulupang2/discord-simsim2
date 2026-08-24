export interface TriggerMessage {
  readonly content: string;
  readonly authorIsBot: boolean;
  readonly isWebhook: boolean;
  readonly isDirectMessage: boolean;
  readonly botUserId: string;
}

export function extractPrompt(message: TriggerMessage): string | null {
  if (message.authorIsBot || message.isWebhook) {
    return null;
  }

  const escapedBotUserId = message.botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ownMention = new RegExp(`<@!?${escapedBotUserId}>`, "g");
  const explicitlyMentionsBot = message.content.search(ownMention) !== -1;

  if (!message.isDirectMessage && !explicitlyMentionsBot) {
    return null;
  }

  const prompt = message.content.replace(ownMention, "").trim();
  return prompt.length === 0 ? null : prompt;
}
