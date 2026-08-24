const DEFAULT_LLM_BASE_URL = "https://api.tokenrouter.com/v1";
const DEFAULT_MAX_HISTORY_MESSAGES = 20;

export interface BotConfig {
  readonly discordToken: string;
  readonly llmApiKey: string;
  readonly llmModel: string;
  readonly llmBaseUrl: string;
  readonly databaseUrl: string;
  readonly systemPrompt: string | undefined;
  readonly maxHistoryMessages: number;
}

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const errors: string[] = [];
  const discordToken = readRequired(env, "DISCORD_TOKEN", errors);
  const llmApiKey = readLlmApiKey(env, errors);
  const llmModel = readLlmModel(env, errors);
  const llmBaseUrl = readBaseUrl(env.LLM_BASE_URL, errors);
  const databaseUrl = readDatabaseUrl(env.DATABASE_URL, errors);
  const maxHistoryMessages = readMaxHistory(env.MAX_HISTORY_MESSAGES, errors);
  const systemPrompt = readSystemPrompt(env.BOT_SYSTEM_PROMPT);
  if (
    errors.length > 0 ||
    discordToken === undefined ||
    llmApiKey === undefined ||
    llmModel === undefined ||
    llmBaseUrl === undefined ||
    databaseUrl === undefined ||
    maxHistoryMessages === undefined
  ) {
    throw new ConfigurationError(
      `Invalid configuration:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }

  return {
    discordToken,
    llmApiKey,
    llmModel,
    llmBaseUrl,
    databaseUrl,
    systemPrompt,
    maxHistoryMessages,
  };
}

function readRequired(
  env: NodeJS.ProcessEnv,
  name: "DISCORD_TOKEN" | "LLM_API_KEY" | "LLM_MODEL",
  errors: string[],
): string | undefined {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) {
    errors.push(`${name} is required and must not be blank.`);
    return undefined;
  }

  return value;
}

function readLlmApiKey(env: NodeJS.ProcessEnv, errors: string[]): string | undefined {
  const value = (env.LLM_API_KEY ?? env.GEMINI_API_KEY)?.trim();
  if (value === undefined || value.length === 0) {
    errors.push("LLM_API_KEY is required and must not be blank.");
    return undefined;
  }
  return value;
}

function readLlmModel(env: NodeJS.ProcessEnv, errors: string[]): string | undefined {
  const value = (env.LLM_MODEL ?? env.GEMINI_MODEL)?.trim();
  if (value === undefined || value.length === 0) {
    errors.push("LLM_MODEL is required and must not be blank.");
    return undefined;
  }
  return value;
}


function readDatabaseUrl(
  rawValue: string | undefined,
  errors: string[],
): string | undefined {
  const value = rawValue?.trim();
  if (value === undefined || value.length === 0) {
    errors.push("DATABASE_URL is required and must not be blank.");
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      errors.push("DATABASE_URL must use postgres:// or postgresql://.");
      return undefined;
    }
    if (url.hostname.length === 0 || url.username.length === 0 || url.pathname === "/") {
      errors.push("DATABASE_URL must include a host, user, and database name.");
      return undefined;
    }

    return value;
  } catch {
    errors.push("DATABASE_URL must be a valid PostgreSQL connection URL.");
    return undefined;
  }
}

function readBaseUrl(rawValue: string | undefined, errors: string[]): string | undefined {
  const value = rawValue?.trim() || DEFAULT_LLM_BASE_URL;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push("LLM_BASE_URL must use http:// or https://.");
      return undefined;
    }
    if (url.username.length > 0 || url.password.length > 0) {
      errors.push("LLM_BASE_URL must not contain credentials; use LLM_API_KEY instead.");
      return undefined;
    }
    if (url.search.length > 0 || url.hash.length > 0) {
      errors.push("LLM_BASE_URL must not contain a query string or fragment.");
      return undefined;
    }

    return url.toString().replace(/\/+$/, "");
  } catch {
    errors.push("LLM_BASE_URL must be a valid absolute URL.");
    return undefined;
  }
}

function readMaxHistory(rawValue: string | undefined, errors: string[]): number | undefined {
  const value = rawValue?.trim();
  if (value === undefined || value.length === 0) {
    return DEFAULT_MAX_HISTORY_MESSAGES;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    errors.push("MAX_HISTORY_MESSAGES must be a positive integer.");
    return undefined;
  }

  return parsed;
}

function readSystemPrompt(rawValue: string | undefined): string | undefined {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return undefined;
  }

  return rawValue;
}
