import fs from "node:fs/promises";
import path from "node:path";
import { createDatabaseConnection } from "../db/client.js";
import { NeonConversationStore } from "../db/conversation-store.js";
import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  console.log("Connecting to Neon Database...");
  const database = createDatabaseConnection(config.databaseUrl);

  await database.ping();
  const store = new NeonConversationStore(database.db);

  console.log("Fetching conversation statistics...");
  const stats = await store.getStatistics();
  console.log("=========================================");
  console.log("📊 Neon DB 대화 데이터셋 통계");
  console.log("=========================================");
  console.log(`- 총 메시지 수: ${stats.totalMessages.toLocaleString()} 건`);
  console.log(`- 사용자 질문: ${stats.userMessages.toLocaleString()} 건`);
  console.log(`- 봇 답변: ${stats.assistantMessages.toLocaleString()} 건`);
  console.log(`- 참여 채널 수: ${stats.channelCount.toLocaleString()} 개`);
  console.log(`- 최초 대화: ${stats.earliestMessage ? stats.earliestMessage.toISOString() : "없음"}`);
  console.log(`- 최근 대화: ${stats.latestMessage ? stats.latestMessage.toISOString() : "없음"}`);
  console.log("=========================================");

  console.log("Exporting fine-tuning dataset (JSONL format)...");
  const samples = await store.exportDataset(
    config.systemPrompt ? { systemPrompt: config.systemPrompt } : undefined,
  );

  const outputPath = path.resolve(process.cwd(), "discord-finetuning-dataset.jsonl");
  const lines = samples.map((sample) => JSON.stringify(sample)).join("\n");
  await fs.writeFile(outputPath, lines, "utf-8");

  console.log(`✅ 데이터셋 추출 완료!`);
  console.log(`- 파일 경로: ${outputPath}`);
  console.log(`- 추출된 학습 샘플 수: ${samples.length} 세션`);
  console.log(`- 포맷: OpenAI / Qwen / Llama Fine-tuning 호환 JSONL (ChatML)`);
}

void main().catch((error) => {
  console.error("Dataset export failed:", error);
  process.exit(1);
});
