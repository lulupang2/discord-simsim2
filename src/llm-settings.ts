import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface BotSettings {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly enableThinking: boolean;
  readonly systemPrompt: string | undefined;
}

export class SettingsValidationError extends Error {
  override readonly name = "SettingsValidationError";
}

export function validateSettings(candidate: BotSettings): void {
  let url: URL;
  try {
    url = new URL(candidate.baseUrl);
  } catch {
    throw new SettingsValidationError("baseUrl must be a valid absolute URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SettingsValidationError("baseUrl must use http:// or https://.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new SettingsValidationError("baseUrl must not contain credentials.");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new SettingsValidationError("baseUrl must not contain a query string or fragment.");
  }
  if (candidate.model.trim().length === 0) {
    throw new SettingsValidationError("model must not be blank.");
  }
  if (candidate.apiKey.trim().length === 0) {
    throw new SettingsValidationError("apiKey must not be blank.");
  }
  if (!Number.isSafeInteger(candidate.maxTokens) || candidate.maxTokens < 16 || candidate.maxTokens > 8192) {
    throw new SettingsValidationError("maxTokens must be an integer between 16 and 8192.");
  }
  if (typeof candidate.enableThinking !== "boolean") {
    throw new SettingsValidationError("enableThinking must be a boolean.");
  }
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return "••••••••";
  }
  return `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`;
}

export class FileSettingsStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async load(): Promise<BotSettings | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.#filePath, "utf8");
    } catch {
      return undefined;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<BotSettings>;
      const settings: BotSettings = {
        baseUrl: String(parsed.baseUrl ?? ""),
        apiKey: String(parsed.apiKey ?? ""),
        model: String(parsed.model ?? ""),
        maxTokens: Number(parsed.maxTokens),
        enableThinking: parsed.enableThinking === undefined ? true : Boolean(parsed.enableThinking),
        systemPrompt: parsed.systemPrompt === null ? undefined : parsed.systemPrompt,
      };
      validateSettings(settings);
      return settings;
    } catch (error) {
      throw new SettingsValidationError(
        `Saved settings file is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async save(settings: BotSettings): Promise<void> {
    validateSettings(settings);
    const temporaryPath = `${this.#filePath}.tmp`;
    await mkdir(dirname(this.#filePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.#filePath);
  }
}
