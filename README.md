# Discord LLM Chatbot

A small Discord conversational bot backed by an OpenAI-compatible chat-completions API.

## Prerequisites

- Node.js 20 or newer and npm
- A Discord application with a bot user and token
- An API key and model name for an OpenAI-compatible provider
- A Neon PostgreSQL project and connection URL

In the Discord Developer Portal, enable the privileged **Message Content Intent** for the bot. The client also requests the Guilds, Guild Messages, and Direct Messages gateway intents. Invite it with permission to view channels, send messages, and read message history wherever it should answer.

## Environment

Use `.env.example` as a reference and inject real values through the process environment. The application does not load `.env` files itself.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Discord bot token |
| `LLM_API_KEY` | yes | Provider API key |
| `LLM_MODEL` | yes | Chat-completions model identifier |
| `DATABASE_URL` | yes | Neon PostgreSQL connection URL |
| `LLM_BASE_URL` | no | API root; defaults to `https://api.openai.com/v1` |
| `BOT_SYSTEM_PROMPT` | no | System instruction included in every request |
| `MAX_HISTORY_MESSAGES` | no | Recent messages sent to the LLM per channel; defaults to `20` |

PowerShell example:

```powershell
$env:DISCORD_TOKEN = "your-token"
$env:LLM_API_KEY = "your-api-key"
$env:LLM_MODEL = "your-model"
$env:DATABASE_URL = "postgresql://user:password@host/neondb?sslmode=require"
```

Configuration is validated before Discord login. Invalid or missing values stop startup with variable names and corrective guidance, never secret values.

## Commands

```text
npm install
npm run db:generate
npm run db:migrate
npm test
npm run typecheck
npm run build
npm start
```

`npm run db:generate` creates SQL migrations from `src/db/schema.ts`; commit the generated files under `drizzle/`. Run `npm run db:migrate` against the target database before starting a new release. `npm test` runs deterministic unit tests without Discord, LLM, or Neon network calls. `npm run build` writes the runnable JavaScript to `dist/`; `npm start` executes `dist/index.js`.

## Behavior

- Non-bot direct messages trigger a response.
- Guild messages trigger only when their text explicitly contains this bot's user mention.
- Bot messages, webhook messages, unmentioned guild messages, and prompts blank after removing the bot's own mention are ignored.
- Accepted messages receive a typing indicator while their request is processed.
- Requests are serialized per channel, while different channels remain independent.
- Successful user/assistant exchanges are retained in Neon without an application-level row limit.
- Only the latest `MAX_HISTORY_MESSAGES` rows are sent to the LLM, so stored history does not make every request grow forever.
- Console records are also written asynchronously to Neon's `bot_logs` table.
- Long model output is sent completely in ordered messages of at most 2,000 characters.
- Provider, Discord, and database failures are logged without credentials and handled without terminating the process. When possible, the user receives a short retry message.
- `SIGINT` and `SIGTERM` close the Discord client cleanly.

## Persistence

Successful conversations are stored in the `messages` table, keyed by Discord channel ID. Bot logs are stored in `bot_logs` while remaining available through stdout or systemd's journal. The application does not delete either table automatically; configure Neon retention, export, or deletion policies according to storage cost and privacy requirements. Failed LLM calls and responses that Discord could not deliver are logged but are not committed as successful conversation exchanges.
