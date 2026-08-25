import { describe, expect, it } from "vitest";
import {
  LlmProviderError,
  OpenAICompatibleClient,
} from "../src/llm.js";

describe("OpenAICompatibleClient", () => {
  it("calls chat completions and forwards the completed text as one delta", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const deltas: string[] = [];
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "qwen/qwen3.8-max-free",
      baseUrl: "https://api.tokenrouter.com/v1/",
      fetchImpl: async (input, init) => {
        capturedUrl = input;
        capturedInit = init;
        return new Response(JSON.stringify({
          choices: [{ message: { content: "테스트 성공" } }],
        }), { status: 200 });
      },
    });

    const response = await client.stream({
      systemPrompt: "반말로 답해",
      messages: [{ role: "user", content: "질문" }],
      onDelta: (text) => {
        deltas.push(text);
      },
    });

    expect(response).toBe("테스트 성공");
    expect(deltas).toEqual(["테스트 성공"]);
    expect(capturedUrl).toBe("https://api.tokenrouter.com/v1/chat/completions");
    expect(capturedInit?.headers).toEqual({
      authorization: "Bearer test-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: "qwen/qwen3.8-max-free",
      messages: [
        { role: "system", content: "반말로 답해" },
        { role: "user", content: "질문" },
      ],
    });
  });

  it("retries a transient 503 response", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "qwen/qwen3.8-max-free",
      baseUrl: "https://api.tokenrouter.com/v1",
      sleepImpl: async (milliseconds) => {
        delays.push(milliseconds);
      },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("busy", { status: 503 });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }), { status: 200 });
      },
    });

    const response = await client.stream({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "hi" }],
      onDelta: () => undefined,
    });

    expect(response).toBe("ok");
    expect(attempts).toBe(2);
    expect(delays).toEqual([1_000]);
  });

  it("retries transient 502 and 504 gateway responses", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "qwen-3.8-max-free",
      baseUrl: "https://router.bynara.id/v1",
      sleepImpl: async (milliseconds) => {
        delays.push(milliseconds);
      },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("bad gateway", { status: 502 });
        }
        if (attempts === 2) {
          return new Response("gateway timeout", { status: 504 });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: "recovered" } }],
        }), { status: 200 });
      },
    });

    const response = await client.stream({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "hi" }],
      onDelta: () => undefined,
    });

    expect(response).toBe("recovered");
    expect(attempts).toBe(3);
    expect(delays).toEqual([1_000, 2_000]);
  });

  it("reports provider errors without response-body leakage", async () => {
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "qwen/qwen3.8-max-free",
      baseUrl: "https://api.tokenrouter.com/v1",
      fetchImpl: async () => new Response("secret provider body", { status: 403 }),
    });

    await expect(client.stream({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "hi" }],
      onDelta: () => undefined,
    })).rejects.toEqual(new LlmProviderError("The LLM provider returned HTTP 403."));
  });

  it("includes the structured provider error message without exposing raw response bodies", async () => {
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "deepseek/deepseek-v4-flash-vision-exp",
      baseUrl: "https://openrouter.ai/api/v1",
      fetchImpl: async () => new Response(JSON.stringify({
        error: { message: "No endpoints found that support this model." },
      }), { status: 404 }),
    });

    await expect(client.stream({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "hi" }],
      onDelta: () => undefined,
    })).rejects.toEqual(
      new LlmProviderError("The LLM provider returned HTTP 404: No endpoints found that support this model."),
    );
  });

  it("does not duplicate a supplied chat completions path", async () => {
    let capturedUrl: string | undefined;
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://openrouter.ai/api/v1/chat/completions/",
      fetchImpl: async (input) => {
        capturedUrl = input;
        return new Response(JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }), { status: 200 });
      },
    });

    await client.stream({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "hi" }],
      onDelta: () => undefined,
    });

    expect(capturedUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(client.getProviderSettings().baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("enables OpenRouter web search and appends validated source citations", async () => {
    let capturedInit: RequestInit | undefined;
    const deltas: string[] = [];
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "upstage/solar-pro4",
      baseUrl: "https://openrouter.ai/api/v1",
      enableWebSearch: true,
      fetchImpl: async (_input, init) => {
        capturedInit = init;
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: "최신 정보를 찾았어.",
              annotations: [
                {
                  type: "url_citation",
                  url_citation: {
                    url: "https://example.com/news",
                    title: "Example News",
                  },
                },
                {
                  type: "url_citation",
                  url_citation: {
                    url: "javascript:alert(1)",
                    title: "Unsafe",
                  },
                },
              ],
            },
          }],
        }), { status: 200 });
      },
    });

    const response = await client.stream({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "최신 뉴스 알려줘" }],
      onDelta: (text) => {
        deltas.push(text);
      },
    });

    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      model: "upstage/solar-pro4",
      tools: [{
        type: "openrouter:web_search",
        parameters: {
          engine: "auto",
          max_results: 3,
          max_uses: 1,
          search_context_size: "low",
        },
      }],
    });
    expect(response).toBe("최신 정보를 찾았어.\n\n출처:\n- [Example News](https://example.com/news)");
    expect(deltas).toEqual([response]);
  });
  it("includes max_tokens in the request body when configured", async () => {
    let capturedInit: RequestInit | undefined;
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "qwen/qwen3.8-max-free",
      baseUrl: "https://api.tokenrouter.com/v1",
      maxTokens: 300,
      fetchImpl: async (_input, init) => {
        capturedInit = init;
        return new Response(JSON.stringify({
          choices: [{ message: { content: "짧은 답변" } }],
        }), { status: 200 });
      },
    });

    const response = await client.stream({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "질문" }],
      onDelta: () => undefined,
    });

    expect(response).toBe("짧은 답변");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: "qwen/qwen3.8-max-free",
      messages: [{ role: "user", content: "질문" }],
      max_tokens: 300,
    });
  });

  it("sends enable_thinking false when disabled in provider settings", async () => {
    let capturedInit: RequestInit | undefined;
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "qwen/qwen3.8-max-free",
      baseUrl: "https://api.tokenrouter.com/v1",
      maxTokens: 300,
      enableThinking: false,
      fetchImpl: async (_input, init) => {
        capturedInit = init;
        return new Response(JSON.stringify({
          choices: [{ message: { content: "빠른 답변" } }],
        }), { status: 200 });
      },
    });

    await client.stream({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "질문" }],
      onDelta: () => undefined,
    });

    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: "qwen/qwen3.8-max-free",
      messages: [{ role: "user", content: "질문" }],
      max_tokens: 300,
      enable_thinking: false,
    });
  });

  it("extracts reasoning_content when content is empty or null", async () => {
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "qwen/qwen3.8-max-free",
      baseUrl: "https://api.tokenrouter.com/v1",
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          message: {
            content: null,
            reasoning_content: "추론 결과 답변입니다.",
          },
        }],
      }), { status: 200 }),
    });

    const response = await client.stream({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "질문" }],
      onDelta: () => undefined,
    });

    expect(response).toBe("추론 결과 답변입니다.");
  });

  it("returns a descriptive notice when finish_reason is length and content is empty", async () => {
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "qwen/qwen3.8-max-free",
      baseUrl: "https://api.tokenrouter.com/v1",
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          finish_reason: "length",
          message: { content: "" },
        }],
      }), { status: 200 }),
    });

    const response = await client.stream({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "질문" }],
      onDelta: () => undefined,
    });

    expect(response).toContain("최대 토큰 한도에 도달했습니다");
  });

  it("returns citations notice when search returned citations but no summary text", async () => {
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "upstage/solar-pro4",
      baseUrl: "https://openrouter.ai/api/v1",
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          message: {
            content: "",
            annotations: [{
              type: "url_citation",
              url_citation: { url: "https://example.com/item", title: "Example" },
            }],
          },
        }],
      }), { status: 200 }),
    });

    const response = await client.stream({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "검색해줘" }],
      onDelta: () => undefined,
    });

    expect(response).toContain("검색 결과를 확인했으나 요약 텍스트를 생성하지 못했습니다.");
    expect(response).toContain("[Example](https://example.com/item)");
  });

  it("forwards multimodal content parts including image_url", async () => {
    let capturedInit: RequestInit | undefined;
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      model: "google/gemini-2.5-flash",
      baseUrl: "https://openrouter.ai/api/v1",
      fetchImpl: async (_input, init) => {
        capturedInit = init;
        return new Response(JSON.stringify({
          choices: [{ message: { content: "고양이 사진이네요." } }],
        }), { status: 200 });
      },
    });

    const response = await client.stream({
      systemPrompt: undefined,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "이 이미지 뭐야?" },
          { type: "image_url", image_url: { url: "https://cdn.discordapp.com/attachments/123/cat.png" } },
        ],
      }],
      onDelta: () => undefined,
    });

    expect(response).toBe("고양이 사진이네요.");
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      model: "google/gemini-2.5-flash",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "이 이미지 뭐야?" },
          { type: "image_url", image_url: { url: "https://cdn.discordapp.com/attachments/123/cat.png" } },
        ],
      }],
    });
  });
});

