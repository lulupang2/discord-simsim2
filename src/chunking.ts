export const DISCORD_MESSAGE_LIMIT = 2_000;

export function splitDiscordMessage(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let offset = 0;

  while (offset < content.length) {
    let end = Math.min(offset + DISCORD_MESSAGE_LIMIT, content.length);

    if (end < content.length) {
      const previousCodeUnit = content.charCodeAt(end - 1);
      const nextCodeUnit = content.charCodeAt(end);
      const splitsSurrogatePair =
        previousCodeUnit >= 0xd800 &&
        previousCodeUnit <= 0xdbff &&
        nextCodeUnit >= 0xdc00 &&
        nextCodeUnit <= 0xdfff;

      if (splitsSurrogatePair) {
        end -= 1;
      }
    }

    chunks.push(content.slice(offset, end));
    offset = end;
  }

  return chunks;
}
