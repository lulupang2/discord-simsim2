import { describe, expect, it } from "vitest";
import { analyzeUserChatStyle, formatUserChatStylePrompt } from "../src/chat-style.js";

describe("analyzeUserChatStyle", () => {
  it("requires three non-blank messages before inferring a profile", () => {
    expect(analyzeUserChatStyle(["안녕", ""])).toBeUndefined();
  });

  it("extracts deterministic style signals from Korean chat messages", () => {
    const style = analyzeUserChatStyle([
      "오늘 뭐해 ㅋㅋ",
      "그거 진짜임?? ㅋㅋ",
      "ㅇㅇ 개웃기네!!",
      "나중에 보자 ㅎㅎ ㅇㅇ",
    ]);

    expect(style).toMatchObject({
      sampleSize: 4,
      speechLevel: "casual",
      messageLength: "short",
      questionRate: 25,
      exclamationRate: 25,
      frequentMarkers: expect.arrayContaining(["ㅋㅋ", "ㅇㅇ"]),
    });
  });

  it("keeps polite speech distinct and formats a safe style-reference prompt", () => {
    const style = analyzeUserChatStyle([
      "확인해 주세요.",
      "내일 다시 알려주세요.",
      "감사합니다.",
    ]);

    expect(style).toMatchObject({ speechLevel: "polite", messageLength: "short" });
    expect(formatUserChatStylePrompt(style!)).toContain("존댓말 중심");
    expect(formatUserChatStylePrompt(style!)).toContain("기계적으로 따라 하거나 과장하지 마");
  });
});
