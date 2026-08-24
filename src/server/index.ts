import { Elysia, t } from "elysia";
import { node } from "@elysiajs/node";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import type { Client } from "discord.js";
import type { BotConfig } from "../config.js";
import type { NeonConversationStore } from "../db/conversation-store.js";
import type { LlmStreamClient } from "../llm.js";
import type { Logger } from "../logging.js";
import { getDashboardHtml } from "./dashboard-html.js";

export interface ElysiaServerOptions {
  readonly port: number;
  readonly config: BotConfig;
  readonly store: NeonConversationStore;
  readonly llm: LlmStreamClient;
  readonly client: Client;
  readonly logger: Logger;
}

export function createElysiaServer(options: ElysiaServerOptions) {
  const { port, config, store, llm, client, logger } = options;

  const app = new Elysia({ adapter: node() })
    .use(cors())
    .use(
      swagger({
        path: "/swagger",
        documentation: {
          info: {
            title: "🐾 GuideDog Admin API",
            description: "Discord LLM Chatbot & RAG Engine Management API",
            version: "1.0.0",
          },
        },
      }),
    )
    // 1. Dashboard UI
    .get("/", ({ set }) => {
      set.headers["content-type"] = "text/html; charset=utf-8";
      return getDashboardHtml();
    })
    .get("/admin", ({ set }) => {
      set.headers["content-type"] = "text/html; charset=utf-8";
      return getDashboardHtml();
    })

    // 2. Health check
    .get("/health", () => ({
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      botStatus: client.isReady() ? "online" : "connecting",
      model: config.llmModel,
      timestamp: new Date().toISOString(),
    }))

    // 3. Stats API
    .get("/api/stats", async () => {
      const stats = await store.getStatistics();
      return {
        ...stats,
        model: config.llmModel,
        uptimeSeconds: Math.floor(process.uptime()),
        botTag: client.user?.tag ?? "Connecting...",
      };
    })

    // 4. Messages API (list & filter)
    .get(
      "/api/messages",
      async ({ query }) => {
        const limit = Number(query.limit ?? "50");
        const offset = Number(query.offset ?? "0");
        const channelId = query.channelId?.trim() || undefined;

        const result = await store.listMessages({
          ...(channelId !== undefined ? { channelId } : {}),
          limit,
          offset,
        });
        return result;
      },
      {
        query: t.Object({
          channelId: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      },
    )

    // 5. System logs API (list & filter)
    .get(
      "/api/logs",
      async ({ query }) => {
        const limit = Number(query.limit ?? "50");
        const offset = Number(query.offset ?? "0");
        const level = (query.level as "info" | "warn" | "error") || undefined;

        const result = await store.listLogs({ level, limit, offset });
        return result;
      },
      {
        query: t.Object({
          level: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      },
    )

    // 6. Dataset Export (JSONL file download)
    .get("/api/dataset/export", async () => {
      const samples = await store.exportDataset(
        config.systemPrompt ? { systemPrompt: config.systemPrompt } : undefined,
      );
      const lines = samples.map((sample) => JSON.stringify(sample)).join("\n");

      return new Response(lines, {
        headers: {
          "content-type": "application/x-jsonlines; charset=utf-8",
          "content-disposition": 'attachment; filename="discord-finetuning-dataset.jsonl"',
        },
      });
    })

    // 7. Interactive Test Chat Playground (with RAG)
    .post(
      "/api/test-chat",
      async ({ body }) => {
        const prompt = body.prompt.trim();
        if (!prompt) {
          return { reply: "질문을 입력해주세요." };
        }

        const relevantContext = await store.findRelevant(prompt, { limit: 3 });
        let systemPrompt = config.systemPrompt ?? "너는 디스코드 대화형 어시스턴트 봇 안내견이야.";

        if (relevantContext.length > 0) {
          const contextSnippet = relevantContext
            .map((item) => `[과거 기록] ${item.role === "user" ? "사용자" : "어시스턴트"}: ${item.content}`)
            .join("\n");
          systemPrompt += `\n\n[참고: 관련된 과거 채널 대화 및 지식]\n${contextSnippet}\n위 과거 대화와 지식을 필요시 자연스럽게 참고하여 답변해.`;
        }

        let fullReply = "";
        try {
          fullReply = await llm.stream({
            messages: [{ role: "user", content: prompt }],
            systemPrompt,
            onDelta: (delta) => {
              fullReply += delta;
            },
          });
        } catch (err) {
          logger.error("Web test chat failed", { error: String(err) });
          return { reply: `[오류 발생] LLM 호출 실패: ${String(err)}` };
        }

        return { reply: fullReply, ragItemsCount: relevantContext.length };
      },
      {
        body: t.Object({
          prompt: t.String(),
        }),
      },
    );

  app.listen(port);
  logger.info(`Elysia Web Dashboard server listening on http://0.0.0.0:${port}`);
  return app;
}
