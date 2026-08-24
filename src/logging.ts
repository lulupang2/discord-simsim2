export type LogContext = Readonly<Record<string, unknown>>;
export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export interface LogSink {
  write(level: LogLevel, message: string, context?: LogContext): Promise<void>;
}

export function createLogger(sink?: LogSink): Logger {
  const write = (
    level: LogLevel,
    message: string,
    context: LogContext | undefined,
  ): void => {
    writeConsole(level, message, context);
    if (sink !== undefined) {
      void sink.write(level, message, context).catch((error: unknown) => {
        console.error("Database log persistence failed.", {
          error: error instanceof Error ? error.name : "UnknownError",
        });
      });
    }
  };

  return {
    info(message, context): void {
      write("info", message, context);
    },
    warn(message, context): void {
      write("warn", message, context);
    },
    error(message, context): void {
      write("error", message, context);
    },
  };
}

export const consoleLogger: Logger = createLogger();

export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    const summary = `${error.name}: ${error.message}`;
    return redactCredentialLikeText(summary).slice(0, 500);
  }

  return "Unknown non-Error failure";
}

function writeConsole(
  level: LogLevel,
  message: string,
  context: LogContext | undefined,
): void {
  const output = level === "info"
    ? console.info
    : level === "warn"
    ? console.warn
    : console.error;

  if (context === undefined) {
    output(message);
    return;
  }
  output(message, context);
}

function redactCredentialLikeText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|token|password|database[_-]?url)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/gi,
      "$1[REDACTED]@",
    );
}
