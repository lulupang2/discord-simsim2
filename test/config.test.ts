import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  loadConfig,
} from "../src/config.js";

const REQUIRED_ENV: NodeJS.ProcessEnv = {
  DISCORD_TOKEN: "discord-token",
  LLM_API_KEY: "llm-key",
  LLM_MODEL: "model-name",
  DATABASE_URL: "postgresql://user:password@db.example/neondb?sslmode=require",
};

describe("loadConfig", () => {
  it("loads required values and applies optional defaults", () => {
    expect(loadConfig(REQUIRED_ENV)).toEqual({
      discordToken: "discord-token",
      llmApiKey: "llm-key",
      llmModel: "model-name",
      llmBaseUrl: "https://api.tokenrouter.com/v1",
      databaseUrl: "postgresql://user:password@db.example/neondb?sslmode=require",
      systemPrompt: undefined,
      maxHistoryMessages: 20,
      llmMaxTokens: 300,
      port: 3000,
    });
  });

  it("loads explicit optional values", () => {
    expect(loadConfig({
      ...REQUIRED_ENV,
      LLM_BASE_URL: "https://provider.example/openai/v1/",
      BOT_SYSTEM_PROMPT: "  preserve this spacing  ",
      MAX_HISTORY_MESSAGES: "7",
    })).toEqual({
      discordToken: "discord-token",
      llmApiKey: "llm-key",
      llmModel: "model-name",
      llmBaseUrl: "https://provider.example/openai/v1",
      databaseUrl: "postgresql://user:password@db.example/neondb?sslmode=require",
      systemPrompt: "  preserve this spacing  ",
      maxHistoryMessages: 7,
      llmMaxTokens: 300,
      port: 3000,
    });
  });

  it("identifies every missing required variable without printing values", () => {
    let error: unknown;
    try {
      loadConfig({
        DISCORD_TOKEN: " ",
        LLM_API_KEY: "",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigurationError);
    expect(String(error)).toContain("DISCORD_TOKEN");
    expect(String(error)).toContain("LLM_API_KEY");
    expect(String(error)).toContain("LLM_MODEL");
    expect(String(error)).toContain("DATABASE_URL");
  });

  it.each(["0", "-1", "1.5", "not-a-number"])(
    "rejects invalid MAX_HISTORY_MESSAGES value %s",
    (value) => {
      expect(() => loadConfig({
        ...REQUIRED_ENV,
        MAX_HISTORY_MESSAGES: value,
      })).toThrow("MAX_HISTORY_MESSAGES must be a positive integer.");
    },
  );

  it.each(["0", "15", "8193", "1.5", "not-a-number"])(
    "rejects invalid LLM_MAX_TOKENS value %s",
    (value) => {
      expect(() => loadConfig({
        ...REQUIRED_ENV,
        LLM_MAX_TOKENS: value,
      })).toThrow("LLM_MAX_TOKENS must be an integer between 16 and 8192.");
    },
  );

  it("rejects unsafe base URLs without exposing credentials", () => {
    const embeddedSecret = "do-not-print-this-secret";
    let error: unknown;
    try {
      loadConfig({
        ...REQUIRED_ENV,
        LLM_BASE_URL: `https://user:${embeddedSecret}@provider.example/v1`,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigurationError);
    expect(String(error)).toContain("must not contain credentials");
    expect(String(error)).not.toContain(embeddedSecret);
  });

  it("rejects invalid database URLs without exposing credentials", () => {
    const embeddedSecret = "database-password-secret";
    let error: unknown;
    try {
      loadConfig({
        ...REQUIRED_ENV,
        DATABASE_URL: `https://user:${embeddedSecret}@db.example/neondb`,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigurationError);
    expect(String(error)).toContain("DATABASE_URL must use postgres");
    expect(String(error)).not.toContain(embeddedSecret);
  });
});
