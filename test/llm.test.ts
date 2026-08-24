import { describe, expect, it } from "vitest";
import {
  GeminiInteractionsClient,
  LlmProviderError,
} from "../src/llm.js";

function sseEvent(eventType: string, data: object | string): string {
  const dataString = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${eventType}\ndata: ${dataString}\n\n`;
}

function sseData(data: object | string): string {
  const dataString = typeof data === "string" ? data : JSON.stringify(data);
  return `data: ${dataString}\n\n`;
}

describe("GeminiInteractionsClient", () => {
  it("streams text deltas from Google streamGenerateContent SSE endpoint", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const receivedDeltas: string[] = [];

    const streamBody = [
      sseData({ candidates: [{ content: { parts: [{ text: "안녕", thought: false }] } }] }),
      sseData({ candidates: [{ content: { parts: [{ text: "하세요!", thought: false }] } }] }),
      "data: [DONE]\n\n",
    ].join("");

    const encoder = new TextEncoder();
    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      capturedUrl = String(input);
      capturedInit = init;

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(streamBody));
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const client = new GeminiInteractionsClient({
      apiKey: "gemini-test-key",
      model: "gemini-3.7-flash",
      thinkingLevel: "low",
      baseUrl: "https://generativelanguage.googleapis.com",
      fetchImpl,
    });

    const assembled = await client.stream({
      systemPrompt: "반말로 답해",
      messages: [
        { role: "user", content: "질문" },
        { role: "assistant", content: "이전 답변" },
      ],
      onDelta: (delta) => {
        receivedDeltas.push(delta);
      },
    });

    expect(assembled).toBe("안녕하세요!");
    expect(receivedDeltas).toEqual(["안녕", "하세요!"]);
    expect(capturedUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:streamGenerateContent?alt=sse");
    expect(capturedInit?.headers).toEqual({
      "x-goog-api-key": "gemini-test-key",
      "content-type": "application/json",
    });

    const parsedBody = JSON.parse(String(capturedInit?.body));
    expect(parsedBody).toEqual({
      contents: [
        { role: "user", parts: [{ text: "질문" }] },
        { role: "model", parts: [{ text: "이전 답변" }] },
      ],
      generationConfig: {
        thinkingConfig: {
          thinkingLevel: "low",
        },
      },
      systemInstruction: {
        parts: [{ text: "반말로 답해" }],
      },
    });
  });

  it("normalizes base URLs by stripping trailing /v1beta/openai or /v1", async () => {
    let capturedUrl: string | undefined;
    const streamBody = sseData({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    const encoder = new TextEncoder();

    const client = new GeminiInteractionsClient({
      apiKey: "gemini-test-key",
      model: "gemini-3.7-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/interactions/",
      fetchImpl: async (input) => {
        capturedUrl = String(input);
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(streamBody));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      },
    });

    await client.stream({
      systemPrompt: undefined,
      messages: [{ role: "user", content: "hi" }],
      onDelta: () => undefined,
    });

    expect(capturedUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:streamGenerateContent?alt=sse");
  });

  it("retries transient 503 responses before streaming", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const encoder = new TextEncoder();
    const client = new GeminiInteractionsClient({
      apiKey: "gemini-test-key",
      model: "gemini-3.7-flash",
      sleepImpl: async (milliseconds) => {
        delays.push(milliseconds);
      },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("high demand", { status: 503 });
        }
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(
              sseData({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
            ));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
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
  it("handles HTTP error status without leaking secrets", async () => {
    const client = new GeminiInteractionsClient({
      apiKey: "gemini-test-key",
      model: "gemini-3.7-flash",

      fetchImpl: async () => new Response("secret error message", { status: 403 }),
    });

    await expect(
      client.stream({
        systemPrompt: undefined,
        messages: [{ role: "user", content: "hi" }],
        onDelta: () => undefined,
      }),
    ).rejects.toThrow("The Gemini API returned HTTP 403.");
  });

  it("handles stream error event gracefully", async () => {
    const streamBody = sseData({ error: { message: "quota exceeded" } });
    const encoder = new TextEncoder();
    const client = new GeminiInteractionsClient({
      apiKey: "gemini-test-key",
      model: "gemini-3.7-flash",
      fetchImpl: async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(streamBody));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      },
    });

    await expect(
      client.stream({
        systemPrompt: undefined,
        messages: [{ role: "user", content: "hi" }],
        onDelta: () => undefined,
      }),
    ).rejects.toThrow("The Gemini stream reported an error event.");
  });
});
