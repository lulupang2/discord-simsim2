export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export const consoleLogger: Logger = {
  info(message, context): void {
    if (context === undefined) {
      console.info(message);
      return;
    }
    console.info(message, context);
  },
  warn(message, context): void {
    if (context === undefined) {
      console.warn(message);
      return;
    }
    console.warn(message, context);
  },
  error(message, context): void {
    if (context === undefined) {
      console.error(message);
      return;
    }
    console.error(message, context);
  },
};

export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    const summary = `${error.name}: ${error.message}`;
    return redactCredentialLikeText(summary).slice(0, 500);
  }

  return "Unknown non-Error failure";
}

function redactCredentialLikeText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}
