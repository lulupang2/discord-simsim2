import { describe, expect, it } from "vitest";
import { extractPrompt, type TriggerMessage } from "../src/trigger.js";

const BASE_MESSAGE: TriggerMessage = {
  content: "hello",
  authorIsBot: false,
  isWebhook: false,
  isDirectMessage: false,
  botUserId: "123456",
};

describe("extractPrompt", () => {
  it("accepts and trims a non-bot direct message", () => {
    expect(extractPrompt({
      ...BASE_MESSAGE,
      content: "  hello from a DM  ",
      isDirectMessage: true,
    })).toBe("hello from a DM");
  });

  it("accepts a guild message with an explicit own-user mention", () => {
    expect(extractPrompt({
      ...BASE_MESSAGE,
      content: "<@123456> explain this",
    })).toBe("explain this");
  });

  it("removes all own mentions while preserving every other mention", () => {
    expect(extractPrompt({
      ...BASE_MESSAGE,
      content: " <@123456> ask <@999999> about <@!123456> this ",
    })).toBe("ask <@999999> about  this");
  });

  it("provides a default description prompt when an attachment is present without text", () => {
    expect(extractPrompt({
      ...BASE_MESSAGE,
      content: "<@123456>",
      hasAttachments: true,
    })).toBe("이 이미지에 대해 설명해줘.");
  });

  it.each([
    ["bot author", { authorIsBot: true }],
    ["webhook", { isWebhook: true }],
    ["unmentioned guild message", {}],
    ["blank mentioned prompt", { content: "  <@123456>  " }],
    ["blank direct message", { content: "   ", isDirectMessage: true }],
  ] as const)("ignores %s", (_label, overrides) => {
    expect(extractPrompt({ ...BASE_MESSAGE, ...overrides })).toBeNull();
  });
});
