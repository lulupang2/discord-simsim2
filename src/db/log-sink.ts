import type {
  LogContext,
  LogLevel,
  LogSink,
} from "../logging.js";
import type { Database } from "./client.js";
import { botLogs } from "./schema.js";

export class NeonLogSink implements LogSink {
  public constructor(private readonly db: Database) {}

  public async write(
    level: LogLevel,
    message: string,
    context?: LogContext,
  ): Promise<void> {
    await this.db.insert(botLogs).values({
      level,
      message,
      context: serializeContext(context),
    });
  }
}

function serializeContext(
  context: LogContext | undefined,
): Readonly<Record<string, unknown>> | null {
  if (context === undefined) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(context)) as Readonly<Record<string, unknown>>;
  } catch {
    return { serializationError: true };
  }
}
