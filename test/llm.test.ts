import { describe, expect, it } from "vitest";
import {
  GeminiInteractionsClient,
  LlmProviderError,
} from "../src/llm.js";

function sseEvent(eventType: string, data: object | string): string {
  const dataString = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${eventType}\ndata: ${dataString}\n\n`;
}

describe("GeminiInteractionsClient", () => {
  it("streams text deltas from Gemini Interactions SSE endpoint", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const receivedDeltas: string[] = [];

    const streamBody = [
      sseEvent("interaction.created", { interaction: { id: "int-1", model: "gemini-3.7-flash" } }),
      sseEvent("step.start", { index: 0, step: { type: "thought" } }),
      sseEvent("step.delta", { index: 0, delta: { type: "thought_signature", signature: "sig" } }),
      sseEvent("step.stop", { index: 0 }),
      sseEvent("step.start", { index: 1, step: { type: "model_output" } }),
      sseEvent("step.delta", { index: 1, delta: { type: "text", text: "안녕" } }),
      sseEvent("step.delta", { index: 1, delta: { type: "text", text: "하세요!" } }),
      sseEvent("step.stop", { index: 1 }),
      sseEvent("interaction.completed", { interaction: { status: "completed" } }),
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
    expect(capturedUrl).toBe("https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse");
    expect(capturedInit?.headers).toEqual({
      "x-goog-api-key": "gemini-test-key",
      "content-type": "application/json",
    });

    const parsedBody = JSON.parse(String(capturedInit?.body));
    expect(parsedBody).toEqual({
      model: "gemini-3.7-flash",
      input: [
        { role: "user", parts: [{ text: "질문" }] },
        { role: "model", parts: [{ text: "이전 답변" }] },
      ],
      stream: true,
      store: false,
      generation_config: {
        thinking_level: "low",
      },
      system_instruction: "반말로 답해",
    });
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
    const streamBody = sseEvent("error", { error: { message: "quota exceeded" } });
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
