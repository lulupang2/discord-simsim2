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
      const settings = coerceBotSettings(JSON.parse(raw) as Partial<BotSettings>);
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

function coerceBotSettings(parsed: Partial<BotSettings>): BotSettings {
  return {
    baseUrl: String(parsed.baseUrl ?? ""),
    apiKey: String(parsed.apiKey ?? ""),
    model: String(parsed.model ?? ""),
    maxTokens: Number(parsed.maxTokens),
    enableThinking: parsed.enableThinking === undefined ? true : Boolean(parsed.enableThinking),
    systemPrompt: parsed.systemPrompt === null ? undefined : parsed.systemPrompt,
  };
}

const MAX_PRESET_NAME_LENGTH = 60;
const PRESET_NAME_CONTROL_CHARS = /[\u0000-\u001f]/;

export function validatePresetName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new SettingsValidationError("Preset name must not be blank.");
  }
  if (trimmed.length > MAX_PRESET_NAME_LENGTH) {
    throw new SettingsValidationError(`Preset name must be at most ${MAX_PRESET_NAME_LENGTH} characters.`);
  }
  if (PRESET_NAME_CONTROL_CHARS.test(trimmed)) {
    throw new SettingsValidationError("Preset name must not contain control characters.");
  }
  return trimmed;
}

export type SettingsPresets = Record<string, BotSettings>;

export class SettingsPresetsStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async load(): Promise<SettingsPresets> {
    let raw: string;
    try {
      raw = await readFile(this.#filePath, "utf8");
    } catch {
      return {};
    }

    try {
      const parsed = JSON.parse(raw) as Partial<SettingsPresets>;
      const presets: SettingsPresets = {};
      for (const [name, value] of Object.entries(parsed)) {
        if (value === undefined || typeof value !== "object") {
          continue;
        }
        try {
          const settings = coerceBotSettings(value);
          validateSettings(settings);
          presets[name] = settings;
        } catch {
          // 하나의 깨진 항목이 대시보드 전체를 막지 않도록 건너뛴다.
        }
      }
      return presets;
    } catch {
      return {};
    }
  }

  async set(name: string, settings: BotSettings): Promise<string> {
    const presetName = validatePresetName(name);
    validateSettings(settings);
    const presets = await this.load();
    presets[presetName] = settings;
    await this.#write(presets);
    return presetName;
  }

  async delete(name: string): Promise<boolean> {
    const presets = await this.load();
    if (!(name in presets)) {
      return false;
    }
    delete presets[name];
    await this.#write(presets);
    return true;
  }

  async #write(presets: SettingsPresets): Promise<void> {
    const temporaryPath = `${this.#filePath}.tmp`;
    await mkdir(dirname(this.#filePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(presets, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.#filePath);
  }
}
