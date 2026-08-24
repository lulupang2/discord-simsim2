import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLogger,
  summarizeError,
  type LogSink,
} from "../src/logging.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLogger", () => {
  it("writes each console record to the configured sink", async () => {
    const write = vi.fn<LogSink["write"]>().mockResolvedValue(undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const logger = createLogger({ write });

    logger.info("bot ready", { channelId: "channel" });
    await Promise.resolve();

    expect(info).toHaveBeenCalledWith("bot ready", { channelId: "channel" });
    expect(write).toHaveBeenCalledWith("info", "bot ready", {
      channelId: "channel",
    });
  });

  it("contains sink failures without recursively writing another database log", async () => {
    const write = vi.fn<LogSink["write"]>().mockRejectedValue(
      new Error("postgresql://user:secret@db.example/neondb"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const logger = createLogger({ write });

    logger.error("provider failed");
    await Promise.resolve();
    await Promise.resolve();

    expect(write).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenLastCalledWith(
      "Database log persistence failed.",
      { error: "Error" },
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
  });
});

describe("summarizeError", () => {
  it("redacts PostgreSQL credentials and credential-like fields", () => {
    const error = new Error(
      "DATABASE_URL=postgresql://user:database-secret@db.example/neondb token=abc123",
    );

    const summary = summarizeError(error);

    expect(summary).not.toContain("database-secret");
    expect(summary).not.toContain("abc123");
    expect(summary).toContain("[REDACTED]");
  });
});
