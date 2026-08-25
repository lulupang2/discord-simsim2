import { Elysia, t } from "elysia";
import { node } from "@elysiajs/node";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import type { Client } from "discord.js";
import type { BotConfig } from "../config.js";
import type { ConversationService } from "../conversation.js";
import type { NeonConversationStore } from "../db/conversation-store.js";
import type { LlmProviderControl } from "../llm.js";
import type { Logger } from "../logging.js";
import {
  maskApiKey,
  validateSettings,
  type BotSettings,
  type FileSettingsStore,
  type SettingsPresetsStore,
} from "../llm-settings.js";
import { getDashboardHtml } from "./dashboard-html.js";

export interface ElysiaServerOptions {
  readonly port: number;
  readonly config: BotConfig;
  readonly store: NeonConversationStore;
  readonly llm: LlmProviderControl;
  readonly conversations: ConversationService;
  readonly settingsStore: FileSettingsStore;
  readonly presetsStore: SettingsPresetsStore;
  readonly defaultSettings: BotSettings;
  readonly client: Client;
  readonly logger: Logger;
}


export function createElysiaServer(options: ElysiaServerOptions) {
  const { port, config, store, llm, conversations, settingsStore, presetsStore, defaultSettings, client, logger } = options;

  const app = new Elysia({ adapter: node() })
    .use(cors())
    .use(
      swagger({
        path: "/swagger",
        documentation: {
          info: {
            title: "🐾 Dapjang Admin API",
            description: "Discord LLM Chatbot & RAG Engine Management API",
            version: "1.0.0",
          },
        },
      }),
    )
    // 1. Dashboard UI
    .get("/", () => new Response(getDashboardHtml(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    }))
    .get("/admin", () => new Response(getDashboardHtml(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    }))

    // 2. Health check
    .get("/health", () => ({
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      botStatus: client.isReady() ? "online" : "connecting",
      model: llm.getProviderSettings().model,
      timestamp: new Date().toISOString(),
    }))

    // 3. Stats API
    .get("/api/stats", async () => {
      const stats = await store.getStatistics();
      return {
        ...stats,
        model: llm.getProviderSettings().model,
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
        let systemPrompt = conversations.systemPrompt ?? "너는 디스코드 대화형 어시스턴트 봇 답장이야.";

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
    )

    // 8. Runtime settings (LLM provider + persona)
    .get("/api/settings", async () => {
      const saved = await settingsStore.load();
      const settings = saved ?? defaultSettings;
      return {
        baseUrl: settings.baseUrl,
        model: settings.model,
        maxTokens: settings.maxTokens,
        enableThinking: settings.enableThinking,
        systemPrompt: settings.systemPrompt ?? null,
        apiKeyMasked: maskApiKey(llm.getProviderSettings().apiKey),
        source: saved === undefined ? "env" : "file",
      };
    })
    .put(
      "/api/settings",
      async ({ body, set }) => {
        const current = (await settingsStore.load()) ?? defaultSettings;
        const candidate = mergeSettingsBody(body, current);
        try {
          validateSettings(candidate);
        } catch (error) {
          set.status = 400;
          return { error: error instanceof Error ? error.message : "Invalid settings." };
        }

        const previousProvider = llm.getProviderSettings();
        llm.updateProviderSettings({
          baseUrl: candidate.baseUrl,
          model: candidate.model,
          apiKey: candidate.apiKey,
          maxTokens: candidate.maxTokens,
          enableThinking: candidate.enableThinking,
        });

        try {
          await llm.testConnection();
        } catch (error) {
          llm.updateProviderSettings(previousProvider);
          set.status = 502;
          return { error: `LLM 연결 테스트 실패, 설정을 저장하지 않았습니다: ${error instanceof Error ? error.message : String(error)}` };
        }

        conversations.setSystemPrompt(candidate.systemPrompt);
        try {
          await settingsStore.save(candidate);
        } catch (error) {
          set.status = 500;
          return { error: `설정 파일 저장 실패: ${error instanceof Error ? error.message : String(error)}` };
        }

        logger.info("Runtime settings updated.", { model: candidate.model, baseUrl: candidate.baseUrl });
        return {
          ok: true,
          settings: {
            baseUrl: candidate.baseUrl,
            model: candidate.model,
            maxTokens: candidate.maxTokens,
            enableThinking: candidate.enableThinking,
            systemPrompt: candidate.systemPrompt ?? null,
            apiKeyMasked: maskApiKey(candidate.apiKey),
          },
        };
      },
      {
        body: t.Object({
          baseUrl: t.Optional(t.String()),
          apiKey: t.Optional(t.String()),
          model: t.Optional(t.String()),
          maxTokens: t.Optional(t.Integer()),
          enableThinking: t.Optional(t.Boolean()),
          systemPrompt: t.Optional(t.Union([t.String(), t.Null()])),
        }),
      },
    )
    // 9. Saved settings presets (추가 / 수정 / 삭제 / 적용)
    .get("/api/settings/presets", async () => {
      const presets = await presetsStore.load();
      return {
        presets: Object.entries(presets).map(([name, preset]) => ({
          name,
          baseUrl: preset.baseUrl,
          model: preset.model,
          maxTokens: preset.maxTokens,
          enableThinking: preset.enableThinking,
          systemPrompt: preset.systemPrompt ?? null,
          apiKeyMasked: maskApiKey(preset.apiKey),
        })),
      };
    })
    .put(
      "/api/settings/presets/:name",
      async ({ body, params, set }) => {
        const current = (await settingsStore.load()) ?? defaultSettings;
        const candidate = mergeSettingsBody(body, current);
        try {
          await presetsStore.set(params.name, candidate);
        } catch (error) {
          set.status = 400;
          return { error: error instanceof Error ? error.message : "프리셋 저장 실패" };
        }
        logger.info("Settings preset saved.", { name: params.name.trim(), model: candidate.model });
        return { ok: true, name: params.name.trim() };
      },
      { params: t.Object({ name: t.String() }), body: t.Object({
        baseUrl: t.Optional(t.String()),
        apiKey: t.Optional(t.String()),
        model: t.Optional(t.String()),
        maxTokens: t.Optional(t.Integer()),
        enableThinking: t.Optional(t.Boolean()),
        systemPrompt: t.Optional(t.Union([t.String(), t.Null()])),
      }) },
    )
    .post(
      "/api/settings/presets/:name/apply",
      async ({ params, set }) => {
        const presets = await presetsStore.load();
        const preset = presets[params.name];
        if (preset === undefined) {
          set.status = 404;
          return { error: "해당 이름의 프리셋이 없습니다." };
        }

        const previousProvider = llm.getProviderSettings();
        llm.updateProviderSettings({
          baseUrl: preset.baseUrl,
          model: preset.model,
          apiKey: preset.apiKey,
          maxTokens: preset.maxTokens,
          enableThinking: preset.enableThinking,
        });

        try {
          await llm.testConnection();
        } catch (error) {
          llm.updateProviderSettings(previousProvider);
          set.status = 502;
          return { error: `LLM 연결 테스트 실패, 프리셋을 적용하지 않았습니다: ${error instanceof Error ? error.message : String(error)}` };
        }

        conversations.setSystemPrompt(preset.systemPrompt);
        try {
          await settingsStore.save(preset);
        } catch (error) {
          set.status = 500;
          return { error: `설정 파일 저장 실패: ${error instanceof Error ? error.message : String(error)}` };
        }

        logger.info("Settings preset applied.", { name: params.name, model: preset.model, baseUrl: preset.baseUrl });
        return {
          ok: true,
          settings: {
            baseUrl: preset.baseUrl,
            model: preset.model,
            maxTokens: preset.maxTokens,
            enableThinking: preset.enableThinking,
            systemPrompt: preset.systemPrompt ?? null,
            apiKeyMasked: maskApiKey(preset.apiKey),
          },
        };
      },
      { params: t.Object({ name: t.String() }) },
    )
    .delete(
      "/api/settings/presets/:name",
      async ({ params, set }) => {
        let removed: boolean;
        try {
          removed = await presetsStore.delete(params.name);
        } catch (error) {
          set.status = 500;
          return { error: `프리셋 삭제 실패: ${error instanceof Error ? error.message : String(error)}` };
        }
        if (!removed) {
          set.status = 404;
          return { error: "해당 이름의 프리셋이 없습니다." };
        }
        logger.info("Settings preset deleted.", { name: params.name });
        return { ok: true };
      },
      { params: t.Object({ name: t.String() }) },
    );

  app.listen(port);
  logger.info(`Elysia Web Dashboard server listening on http://0.0.0.0:${port}`);
  return app;
}

interface SettingsRequestBody {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  enableThinking?: boolean;
  systemPrompt?: string | null;
}

function mergeSettingsBody(body: SettingsRequestBody, current: BotSettings): BotSettings {
  return {
    baseUrl: body.baseUrl?.trim() || current.baseUrl,
    apiKey: body.apiKey?.trim() || current.apiKey,
    model: body.model?.trim() || current.model,
    maxTokens: body.maxTokens ?? current.maxTokens,
    enableThinking: body.enableThinking ?? current.enableThinking,
    systemPrompt: body.systemPrompt === undefined || body.systemPrompt === null
      ? current.systemPrompt
      : (body.systemPrompt.trim().length === 0 ? undefined : body.systemPrompt),
  };
}
