import { splitDiscordMessage } from "./chunking.js";

export interface StreamableMessageHandle {
  edit(content: string): Promise<void>;
}

export interface StreamableChannelTransport {
  sendTyping(): Promise<void>;
  sendInitial(content: string): Promise<StreamableMessageHandle>;
  sendFinalChunk(content: string): Promise<void>;
}

export interface LiveStreamWriterOptions {
  readonly flushIntervalMs?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 800;

export class LiveStreamWriter {
  readonly #transport: StreamableChannelTransport;
  readonly #flushIntervalMs: number;
  #fullText = "";
  #activeHandle: StreamableMessageHandle | undefined;
  #activeBaseOffset = 0;
  #lastFlushedChunk = "";
  #lastFlushTime = 0;
  #closed = false;

  constructor(transport: StreamableChannelTransport, options: LiveStreamWriterOptions = {}) {
    this.#transport = transport;
    this.#flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  get fullText(): string {
    return this.#fullText;
  }

  async appendDelta(delta: string): Promise<void> {
    if (this.#closed || delta.length === 0) {
      return;
    }

    this.#fullText += delta;
    const now = Date.now();
    const shouldFlush = this.#activeHandle === undefined || now - this.#lastFlushTime >= this.#flushIntervalMs;

    if (shouldFlush) {
      await this.#flushCurrent();
    }
  }

  async finish(): Promise<string> {
    if (this.#closed) {
      return this.#fullText;
    }
    this.#closed = true;

    if (this.#fullText.trim().length === 0) {
      return "";
    }

    const allChunks = splitDiscordMessage(this.#fullText);
    if (allChunks.length === 0) {
      return "";
    }

    const firstChunk = allChunks[0] ?? "";
    if (this.#activeHandle === undefined) {
      this.#activeHandle = await this.#transport.sendInitial(firstChunk);
      this.#lastFlushedChunk = firstChunk;
    } else if (firstChunk !== this.#lastFlushedChunk) {
      await this.#activeHandle.edit(firstChunk);
      this.#lastFlushedChunk = firstChunk;
    }

    for (let index = 1; index < allChunks.length; index += 1) {
      const chunk = allChunks[index];
      if (chunk !== undefined && chunk.length > 0) {
        await this.#transport.sendFinalChunk(chunk);
      }
    }

    return this.#fullText;
  }

  async #flushCurrent(): Promise<void> {
    if (this.#fullText.length === 0) {
      return;
    }

    const currentSpan = this.#fullText.slice(this.#activeBaseOffset);
    const chunks = splitDiscordMessage(currentSpan);
    if (chunks.length === 0) {
      return;
    }

    const firstChunk = chunks[0] ?? "";
    if (this.#activeHandle === undefined) {
      this.#activeHandle = await this.#transport.sendInitial(firstChunk);
      this.#lastFlushedChunk = firstChunk;
      this.#lastFlushTime = Date.now();
      return;
    }

    if (firstChunk !== this.#lastFlushedChunk) {
      await this.#activeHandle.edit(firstChunk);
      this.#lastFlushedChunk = firstChunk;
      this.#lastFlushTime = Date.now();
    }
  }
}
