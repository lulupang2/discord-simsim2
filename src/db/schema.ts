import {
  bigserial,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const logLevel = pgEnum("log_level", ["info", "warn", "error"]);

export const messages = pgTable(
  "messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    channelId: text("channel_id").notNull(),
    guildId: text("guild_id"),
    authorId: text("author_id").notNull(),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("messages_channel_created_id_idx").on(
      table.channelId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const botLogs = pgTable(
  "bot_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    level: logLevel("level").notNull(),
    message: text("message").notNull(),
    context: jsonb("context").$type<Readonly<Record<string, unknown>> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("bot_logs_created_id_idx").on(table.createdAt.desc(), table.id.desc()),
  ],
);
