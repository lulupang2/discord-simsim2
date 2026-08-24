import { describe, expect, it } from "vitest";
import {
  LlmProviderError,
  OpenAICompatibleClient,
} from "../src/llm.js";

describe("OpenAICompatibleClient", () => {
  it("calls the chat-completions endpoint with model, history, and system prompt", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "  complete response\n" } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = new OpenAICompatibleClient({
      apiKey: "test-api-key",
      model: "test-model",
      baseUrl: "https://llm.example/v1/",
      fetchImpl,
    });

    const result = await client.complete({
      systemPrompt: "system instruction",
      messages: [
        { role: "user", content: "question" },
        { role: "assistant", content: "prior answer" },
      ],
    });

    expect(result).toBe("  complete response\n");
    expect(capturedUrl).toBe("https://llm.example/v1/chat/completions");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({
      authorization: "Bearer test-api-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: "test-model",
      messages: [
        { role: "system", content: "system instruction" },
        { role: "user", content: "question" },
        { role: "assistant", content: "prior answer" },
      ],
    });
  });

  it("reports HTTP failures without including provider response content", async () => {
    const client = new OpenAICompatibleClient({
      apiKey: "test-api-key",
      model: "test-model",
      baseUrl: "https://llm.example/v1",
      fetchImpl: async () => new Response("provider-secret-body", { status: 503 }),
    });

    const completion = client.complete({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "question" }],
    });

    await expect(completion).rejects.toEqual(
      new LlmProviderError("The LLM provider returned HTTP 503."),
    );
    await expect(completion).rejects.not.toThrow("provider-secret-body");
  });

  it("converts network and malformed-response failures to safe provider errors", async () => {
    const unreachableClient = new OpenAICompatibleClient({
      apiKey: "test-api-key",
      model: "test-model",
      baseUrl: "https://llm.example/v1",
      fetchImpl: async () => {
        throw new Error("socket failure with internal detail");
      },
    });
    await expect(unreachableClient.complete({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "question" }],
    })).rejects.toThrow("Could not reach the LLM provider.");

    const malformedClient = new OpenAICompatibleClient({
      apiKey: "test-api-key",
      model: "test-model",
      baseUrl: "https://llm.example/v1",
      fetchImpl: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    });
    await expect(malformedClient.complete({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "question" }],
    })).rejects.toThrow("The LLM provider returned no text response.");
  });
});
