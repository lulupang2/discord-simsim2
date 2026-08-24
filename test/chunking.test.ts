import { describe, expect, it } from "vitest";
import {
  DISCORD_MESSAGE_LIMIT,
  splitDiscordMessage,
} from "../src/chunking.js";

describe("splitDiscordMessage", () => {
  it("keeps content at the Discord limit in one message", () => {
    const content = "a".repeat(DISCORD_MESSAGE_LIMIT);
    expect(splitDiscordMessage(content)).toEqual([content]);
  });

  it("splits over-limit content without loss or duplication", () => {
    const content = `${"a".repeat(DISCORD_MESSAGE_LIMIT)}${"b".repeat(DISCORD_MESSAGE_LIMIT)}c`;
    const chunks = splitDiscordMessage(content);

    expect(chunks.map((chunk) => chunk.length)).toEqual([2_000, 2_000, 1]);
    expect(chunks.join("")).toBe(content);
    expect(chunks.every((chunk) => chunk.length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
  });

  it("does not split a Unicode surrogate pair at a boundary", () => {
    const content = `${"a".repeat(DISCORD_MESSAGE_LIMIT - 1)}😀b`;
    const chunks = splitDiscordMessage(content);

    expect(chunks.join("")).toBe(content);
    expect(chunks.every((chunk) => chunk.length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
    expect(chunks[0]).toBe("a".repeat(DISCORD_MESSAGE_LIMIT - 1));
    expect(chunks[1]).toBe("😀b");
  });

  it("returns no messages for empty content", () => {
    expect(splitDiscordMessage("")).toEqual([]);
  });
});
