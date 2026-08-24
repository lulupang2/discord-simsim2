import { describe, expect, it } from "vitest";
import {
  LiveStreamWriter,
  type StreamableChannelTransport,
  type StreamableMessageHandle,
} from "../src/stream-writer.js";

class RecordingStreamTransport implements StreamableChannelTransport {
  typingCount = 0;
  readonly initialSends: string[] = [];
  readonly finalChunks: string[] = [];
  readonly edits: string[] = [];

  async sendTyping(): Promise<void> {
    this.typingCount += 1;
  }

  async sendInitial(content: string): Promise<StreamableMessageHandle> {
    this.initialSends.push(content);
    return {
      edit: async (updatedContent: string) => {
        this.edits.push(updatedContent);
      },
    };
  }

  async sendFinalChunk(content: string): Promise<void> {
    this.finalChunks.push(content);
  }
}

describe("LiveStreamWriter", () => {
  it("streams incremental deltas by editing the initial Discord message", async () => {
    const transport = new RecordingStreamTransport();
    const writer = new LiveStreamWriter(transport, { flushIntervalMs: 0 });

    await writer.appendDelta("안녕");
    await writer.appendDelta("하세요!");
    const finalResult = await writer.finish();

    expect(finalResult).toBe("안녕하세요!");
    expect(transport.initialSends).toEqual(["안녕"]);
    expect(transport.edits).toEqual(["안녕하세요!"]);
    expect(transport.finalChunks).toHaveLength(0);
  });

  it("splits large streamed responses into multi-message chunks upon finish", async () => {
    const transport = new RecordingStreamTransport();
    const writer = new LiveStreamWriter(transport, { flushIntervalMs: 0 });

    const hugeText = "A".repeat(2500);
    await writer.appendDelta(hugeText);
    const finalResult = await writer.finish();

    expect(finalResult).toBe(hugeText);
    expect(transport.initialSends).toEqual(["A".repeat(2000)]);
    expect(transport.finalChunks).toEqual(["A".repeat(500)]);
  });

  it("handles empty stream completions gracefully", async () => {
    const transport = new RecordingStreamTransport();
    const writer = new LiveStreamWriter(transport, { flushIntervalMs: 0 });

    const finalResult = await writer.finish();

    expect(finalResult).toBe("");
    expect(transport.initialSends).toHaveLength(0);
    expect(transport.finalChunks).toHaveLength(0);
  });
});
