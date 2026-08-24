# Discord LLM Chatbot

A small Discord conversational bot backed by an OpenAI-compatible chat-completions API.

## Prerequisites

- Node.js 20 or newer and npm
- A Discord application with a bot user and token
- An API key and model name for an OpenAI-compatible provider

In the Discord Developer Portal, enable the privileged **Message Content Intent** for the bot. The client also requests the Guilds, Guild Messages, and Direct Messages gateway intents. Invite it with permission to view channels, send messages, and read message history wherever it should answer.

## Environment

Use `.env.example` as a reference and inject real values through the process environment. The application does not load `.env` files itself.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Discord bot token |
| `LLM_API_KEY` | yes | Provider API key |
| `LLM_MODEL` | yes | Chat-completions model identifier |
| `LLM_BASE_URL` | no | API root; defaults to `https://api.openai.com/v1` |
| `BOT_SYSTEM_PROMPT` | no | System instruction included in every request |
| `MAX_HISTORY_MESSAGES` | no | Positive stored-message limit per channel; defaults to `20` |

PowerShell example:

```powershell
$env:DISCORD_TOKEN = "your-token"
$env:LLM_API_KEY = "your-api-key"
$env:LLM_MODEL = "your-model"
```

Configuration is validated before Discord login. Invalid or missing values stop startup with variable names and corrective guidance, never secret values.

## Commands

```text
npm install
npm test
npm run typecheck
npm run build
npm start
```

`npm test` runs deterministic unit tests without Discord or LLM network calls. During development, run `npm run typecheck` and `npm test` after changes. `npm run build` writes the runnable JavaScript to `dist/`; `npm start` executes `dist/index.js`.

## Behavior

- Non-bot direct messages trigger a response.
- Guild messages trigger only when their text explicitly contains this bot's user mention.
- Bot messages, webhook messages, unmentioned guild messages, and prompts blank after removing the bot's own mention are ignored.
- Accepted messages receive a typing indicator while their request is processed.
- Requests are serialized per channel, while different channels remain independent.
- Long model output is sent completely in ordered messages of at most 2,000 characters.
- Provider and Discord send failures are logged without credentials and handled without terminating the process. When possible, the user receives a short retry message.
- `SIGINT` and `SIGTERM` close the Discord client cleanly.

## History limitation

Conversation history exists only in this process's memory and is keyed by Discord channel or DM channel. It is cleared on restart, is not shared across multiple bot instances, and evicts the oldest chat messages once `MAX_HISTORY_MESSAGES` is exceeded. The optional system prompt is added to each provider request but is not stored in that history.
