export type SpeechLevel = "casual" | "polite" | "mixed" | "neutral";
export type MessageLength = "short" | "medium" | "long";

export interface UserChatStyle {
  readonly sampleSize: number;
  readonly averageCharacters: number;
  readonly speechLevel: SpeechLevel;
  readonly messageLength: MessageLength;
  readonly questionRate: number;
  readonly exclamationRate: number;
  readonly emojiRate: number;
  readonly frequentMarkers: readonly string[];
}

const MINIMUM_STYLE_SAMPLE_SIZE = 3;

const POLITE_ENDING = /(습니다|ㅂ니다|세요|이에요|예요|네요|군요|까요|죠)[.!?~]*$/u;
const CASUAL_ENDING = /(야|어|아|해|함|임|냐|지|네|ㄱ|ㅋㅋ|ㅎㅎ|ㅇㅇ)[.!?~]*$/u;
const EMOJI = /\p{Extended_Pictographic}/u;

const MARKERS = [
  { label: "ㅋㅋ", pattern: /ㅋ{2,}/u },
  { label: "ㅎㅎ", pattern: /ㅎ{2,}/u },
  { label: "ㅇㅇ", pattern: /ㅇㅇ/u },
  { label: "ㅠㅠ", pattern: /ㅠ{2,}/u },
  { label: "!!", pattern: /!{2,}/u },
] as const;

export function analyzeUserChatStyle(messages: readonly string[]): UserChatStyle | undefined {
  const normalizedMessages = messages.map((message) => message.trim()).filter((message) => message.length > 0);
  if (normalizedMessages.length < MINIMUM_STYLE_SAMPLE_SIZE) {
    return undefined;
  }

  const totalCharacters = normalizedMessages.reduce((total, message) => total + message.length, 0);
  const averageCharacters = Math.round(totalCharacters / normalizedMessages.length);
  const politeCount = normalizedMessages.filter((message) => POLITE_ENDING.test(message)).length;
  const casualCount = normalizedMessages.filter((message) => CASUAL_ENDING.test(message)).length;
  const markerCounts = MARKERS.map(({ label, pattern }) => ({
    label,
    count: normalizedMessages.filter((message) => pattern.test(message)).length,
  }));

  return {
    sampleSize: normalizedMessages.length,
    averageCharacters,
    speechLevel: resolveSpeechLevel(politeCount, casualCount),
    messageLength: resolveMessageLength(averageCharacters),
    questionRate: rateOf(normalizedMessages, (message) => /[?？]/u.test(message)),
    exclamationRate: rateOf(normalizedMessages, (message) => /!/u.test(message)),
    emojiRate: rateOf(normalizedMessages, (message) => EMOJI.test(message)),
    frequentMarkers: markerCounts
      .filter(({ count }) => count >= 2)
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "ko"))
      .map(({ label }) => label),
  };
}

export function formatUserChatStylePrompt(style: UserChatStyle): string {
  const speechLevel = {
    casual: "반말 중심",
    polite: "존댓말 중심",
    mixed: "반말과 존댓말 혼용",
    neutral: "뚜렷한 말투 경향 없음",
  }[style.speechLevel];
  const messageLength = {
    short: "짧은 편",
    medium: "보통",
    long: "긴 편",
  }[style.messageLength];
  const markers = style.frequentMarkers.length === 0 ? "뚜렷하지 않음" : style.frequentMarkers.join(", ");

  return `[현재 사용자 채팅 스타일 참고]\n- 분석 표본: 최근 ${style.sampleSize}개 발화\n- 말투: ${speechLevel}\n- 평균 길이: ${style.averageCharacters}자 (${messageLength})\n- 질문/감탄/이모지 사용: ${style.questionRate}% / ${style.exclamationRate}% / ${style.emojiRate}%\n- 자주 쓰는 표현: ${markers}\n이 정보는 자연스럽게 말투를 맞추는 참고용이다. 사실성·안전·명료성을 우선하고, 사용자의 문구를 기계적으로 따라 하거나 과장하지 마.`;
}

function rateOf(messages: readonly string[], predicate: (message: string) => boolean): number {
  return Math.round((messages.filter(predicate).length / messages.length) * 100);
}

function resolveSpeechLevel(politeCount: number, casualCount: number): SpeechLevel {
  if (politeCount === 0 && casualCount === 0) {
    return "neutral";
  }
  if (politeCount > casualCount * 1.5) {
    return "polite";
  }
  if (casualCount > politeCount * 1.5) {
    return "casual";
  }
  return "mixed";
}

function resolveMessageLength(averageCharacters: number): MessageLength {
  if (averageCharacters <= 20) {
    return "short";
  }
  if (averageCharacters <= 80) {
    return "medium";
  }
  return "long";
}
