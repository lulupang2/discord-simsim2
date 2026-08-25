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
});

