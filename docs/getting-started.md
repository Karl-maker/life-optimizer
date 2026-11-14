# Getting started with Life Optimizer

This guide explains how to run Life Optimizer from this repository and use its command-line interface to record, search, import, and review life logs.

## 1. Prerequisites

Install:

- Node.js 22 or later
- pnpm 12.15.0
- Docker Desktop or another Docker Compose-compatible runtime
- Ollama for local AI import and review

Confirm the tools are available:

```sh
node --version
pnpm --version
docker --version
ollama --version
```

Run all following commands from the repository root.

## 2. Install the workspace

```sh
pnpm install
```

## 3. Create local configuration

Create separate environment files for Prisma/database commands and the CLI:

```sh
cp packages/db/.env.example packages/db/.env
cp packages/cli/.env.example packages/cli/.env
```

The supplied development defaults are:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/life_optimizer"
OLLAMA_ENDPOINT="http://localhost:11434"
LIFE_OPTIMIZER_AI_PROVIDER="auto"
LIFE_OPTIMIZER_TIME_ZONE="America/Port_of_Spain"
```

`LIFE_OPTIMIZER_TIME_ZONE` is optional. Set it to the IANA timezone that should be used when a command does not include `--timezone`. Examples include `America/Port_of_Spain`, `America/New_York`, and `Europe/Paris`.

AI requests have a ten-minute default limit because the local `qwen-agent:32k` model is large. To choose another limit, set `OLLAMA_TIMEOUT_MS` to a whole number of milliseconds from `1000` to `1800000` (30 minutes).

To prefer OpenAI whenever an API key is configured, add this to `packages/cli/.env`:

```dotenv
LIFE_OPTIMIZER_AI_PROVIDER="openai"
OPENAI_API_KEY="your-api-key"
```

With `LIFE_OPTIMIZER_AI_PROVIDER="auto"` (the default), a non-empty `OPENAI_API_KEY` selects OpenAI automatically; otherwise the CLI uses local Ollama. OpenAI processing sends the note or selected log context to OpenAI, so select `ollama` when the data must remain on your computer.

You normally do not need `LIFE_OPTIMIZER_AI_MODEL`. If you set it, use the catalog ID `openai-gpt-4.1-mini` or `ollama-qwen-agent-32k`; the familiar provider names `gpt-4.1-mini` and `qwen-agent:32k` are accepted as shortcuts.

Do not commit either `.env` file.

## 4. Start PostgreSQL

Start the durable development database and isolated test database:

```sh
docker compose up -d --wait
```

Check their status:

```sh
docker compose ps
```

Apply the development migrations:

```sh
pnpm db:migrate
```

The migration creates the `life_logs` table and registers the default local AI catalog entry, `ollama-qwen-agent-32k`.

## 5. Start Ollama

If Ollama is not already running, start it in a separate terminal:

```sh
ollama serve
```

Confirm that the configured model exists:

```sh
ollama list
```

The list should contain:

```text
qwen-agent:32k
```

If your Ollama instance uses a different model, register that model in the AI catalog and set its catalog ID through `LIFE_OPTIMIZER_AI_MODEL`. Normal log creation, listing, and search do not require Ollama; only `log import` and `log ask` do.

## 6. Run the CLI

Inside this repository, use:

```sh
pnpm life-optimizer <command> [options]
```

For example:

```sh
pnpm life-optimizer --help
pnpm life-optimizer log add --help
```

Do not place a standalone `--` before the command. Use:

```sh
pnpm life-optimizer user add --name "Karl-Johan Bailey"
```

instead of invoking the package's internal `tsx` script directly.

## 7. Create and select your profile

Create a profile once:

```sh
pnpm life-optimizer user add --name "Karl-Johan Bailey"
```

Select it as the profile used by later commands:

```sh
pnpm life-optimizer user use "Karl-Johan Bailey"
```

Confirm the active profile:

```sh
pnpm life-optimizer whoami
```

To select a profile for only one command, place `--as` after that command's arguments and options:

```sh
pnpm life-optimizer log list --as "Karl-Johan Bailey"
```

## 8. Add life logs

### Record something now

When `--timestamp` is omitted, Life Optimizer records the current instant and current/default timezone:

```sh
pnpm life-optimizer log add \
  --description "Walked for 40 minutes" \
  --type exercise
```

`--type` uses a fixed category so manual and AI-created logs stay consistent. Supported categories are:

- `health`
- `medication`
- `food`
- `exercise`
- `sleep`
- `mood`
- `social`
- `work`
- `travel`
- `finance`
- `household`
- `personal-care`
- `entertainment`
- `dream` — a remembered sleeping dream
- `visualization` — intentional mental imagery
- `manifestation` — speaking or writing a desired outcome into existence
- `prayer` — religious or spiritual prayer
- `idea` — a newly conceived concept, solution, project, or possible action
- `journal`
- `other`

The separate `metadata add` command creates the reserved `metadata` type. Unsupported categories are rejected before any database call. A close typo produces a suggestion (for example, `excercise` suggests `exercise`); otherwise the CLI prints the complete category list. Use `other` only when no specific category fits.

### Record something after it happened

```sh
pnpm life-optimizer log add \
  --description "Headache began" \
  --type health \
  --timestamp "14-11-2026 09:30" \
  --timezone America/Port_of_Spain
```

Accepted timestamp formats are:

- `DD-MM-YYYY HH:mm`
- `DD-MM-YYYY HH:mm:ss`
- ISO 8601 with an explicit offset, such as `2026-11-14T18:10:00+01:00`

Missing seconds default to `00`. Invalid calendar values, unknown IANA timezones, nonexistent daylight-saving times, and ambiguous repeated times are rejected. For an ambiguous daylight-saving time, use ISO 8601 with an explicit offset.

### Add journal entries

Journal entries are ordinary logs with type `journal`. A day may contain any number of them:

```sh
pnpm life-optimizer log add \
  --description "Felt productive in the morning but tired after lunch" \
  --type journal \
  --timestamp "14-11-2026 22:00"
```

### Add key-value metadata

Metadata is stored in the same searchable timeline:

```sh
pnpm life-optimizer metadata add \
  --key screen-time \
  --value 15h \
  --timestamp "14-11-2026 23:00"
```

## 9. Import bulk notes with local AI

Use `log import` when notes contain several events or are written informally:

```sh
pnpm life-optimizer log import \
  --date 14-11-2026 \
  --timezone America/Port_of_Spain \
  --text "7:30 woke wit hedache and drank water. 9 took 500mg and called Sam." \
  --retries 3
```

The importer:

- splits every distinct action, event, observation, or state change into a separate log;
- separates multiple actions even when they share one sentence and timestamp;
- corrects spelling, capitalization, grammar, punctuation, and obvious transcription errors;
- rewrites descriptions into concise, standalone statements;
- chooses only from the same fixed category list used by manual entries;
- preserves names, quantities, uncertainty, order, and meaning;
- does not invent facts or diagnoses;
- validates the JSON structure and every timestamp before writing;
- sends validation feedback to the model and retries up to the requested limit.

`--date` supplies the reference date for phrases such as “today” and “yesterday.” If the input gives no time, the importer uses `12:00:00` and the `journal` type as an explicit fallback instead of inventing a time.

## 10. List and search logs

List recent logs:

```sh
pnpm life-optimizer log list
```

List one local calendar day:

```sh
pnpm life-optimizer log list --date 14-11-2026
```

List a range in chronological order:

```sh
pnpm life-optimizer log list \
  --from 01-11-2026 \
  --to 14-11-2026 \
  --type health \
  --limit 100 \
  --order asc
```

Search descriptions and metadata within a range:

```sh
pnpm life-optimizer log search \
  --query headache \
  --from 01-11-2026 \
  --to 14-11-2026
```

Use `--json` when another program will consume the result:

```sh
pnpm life-optimizer log list --date 14-11-2026 --json
```

## 11. Ask local AI about selected logs

```sh
pnpm life-optimizer log ask \
  --question "When did headaches occur and what did I log afterward?" \
  --from 01-11-2026 \
  --to 14-11-2026 \
  --limit 200
```

The answer is limited to the selected logs and cites supporting instances by log ID. Life Optimizer refuses to send an incomplete or oversized context. If that happens, narrow the selection with `--from`, `--to`, `--type`, or `--search`.

## 12. Everyday startup and shutdown

After the first setup, a normal startup is:

```sh
docker compose up -d --wait
pnpm life-optimizer whoami
```

Stop the containers without deleting their durable data:

```sh
docker compose down
```

The `life-optimizer-pgdata` Docker volume preserves development logs across restarts. Do not run `docker compose down --volumes` unless you intentionally want to remove that database volume.

## Troubleshooting

### `options must come after the command, but found -- first`

Use the root command without a separator:

```sh
pnpm life-optimizer user add --name "Karl-Johan Bailey"
```

The current CLI also ignores one forwarded package-runner separator, but omitting it is simpler and avoids ambiguity.

### `DATABASE_URL is not set`

Create the CLI environment file and confirm it contains the development URL:

```sh
cp packages/cli/.env.example packages/cli/.env
```

Then retry from the repository root.

### No user is selected

```sh
pnpm life-optimizer user list
pnpm life-optimizer user use "Your Name"
```

### PostgreSQL is unavailable

```sh
docker compose ps
docker compose up -d --wait
pnpm db:migrate
```

### Ollama is unavailable

Check that Ollama is running and that the configured model exists:

```sh
ollama list
```

The default endpoint is `http://localhost:11434`. Change `OLLAMA_ENDPOINT` in `packages/cli/.env` if necessary.

### OpenAI is selected unexpectedly

`auto` intentionally prefers OpenAI when `OPENAI_API_KEY` is present. To force the local model, set:

```dotenv
LIFE_OPTIMIZER_AI_PROVIDER="ollama"
```

### AI import times out

`qwen-agent:32k` is a 19 GB model, so a detailed day can take several minutes to turn into structured logs. The CLI allows ten minutes by default and asks Ollama to keep the model loaded for 30 minutes. If your machine needs more time, add this to `packages/cli/.env` and rerun the import:

```dotenv
OLLAMA_TIMEOUT_MS="900000"
```

### AI context is too large

Reduce the selected period or pre-filter it:

```sh
pnpm life-optimizer log ask \
  --question "Summarize my headache logs" \
  --from 01-11-2026 \
  --to 14-11-2026 \
  --type health \
  --search headache
```

### Inspect safe AI request diagnostics

By default, Life Optimizer does not write operational events. To record safe local diagnostics (event name, provider, catalog model ID, duration, and correlation ID only), add a file path to `packages/cli/.env`:

```dotenv
LIFE_OPTIMIZER_LOG_FILE="/absolute/path/to/life-optimizer-events.jsonl"
```

The log deliberately excludes descriptions, journal text, AI prompts, responses, API keys, and database URLs.

## Development verification

Run the local quality gate:

```sh
pnpm verify
```

For database integration tests:

```sh
pnpm test:db
```
