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
});
