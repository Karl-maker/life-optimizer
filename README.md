# Life Optimizer Service

Life Optimizer is a private, self-hostable record of daily life. It stores health, social, psychological, work, travel, journal, and arbitrary personal events so a person can review what happened, search for patterns, and bring reliable history to later decisions or professional conversations.

The current supported product surface is the Life Optimizer CLI backed by PostgreSQL.

For complete installation and usage instructions, see [Getting started with Life Optimizer](docs/getting-started.md).

## Design

Business rules live in `packages/core`, PostgreSQL/Prisma details stay in `packages/db`, and `packages/cli` only parses and renders input. A log stores its absolute instant, the IANA timezone where it happened, and derived local date/time. This keeps chronological ordering correct during travel while preserving day-by-day local review.

Personal log text is sent only to the configured AI provider. The default is local Ollama at `http://localhost:11434` with the catalog model `qwen-agent:32k`; prompts and outputs are never written to telemetry.

## Setup

Requirements: Node.js 22+, pnpm 12.15.0, Docker, and optionally Ollama.

```sh
pnpm install
cp packages/db/.env.example packages/db/.env
pnpm db:up
pnpm db:migrate
pnpm build
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/life_optimizer
```

Create and select a local user once:

```sh
pnpm life-optimizer user add --name "Your Name"
pnpm life-optimizer user use "Your Name"
```

During development, prefix the examples below with `pnpm`, for example `pnpm life-optimizer log list`. A packaged installation exposes the same command directly as `life-optimizer`.

## Life-log commands

Add a log now, or backfill one with local date/time. Seconds default to `00`. Use an explicit IANA timezone when the event occurred somewhere other than the machine's current timezone.

```sh
life-optimizer log add --description "Walked for 40 minutes" --type exercise
life-optimizer log add --description "Headache began" --type health \
  --timestamp "14-11-2026 09:30" --timezone America/Port_of_Spain
life-optimizer log add --description "Flight landed" --type travel \
  --timestamp "2026-11-14T18:10:00+01:00" --timezone Europe/Paris
life-optimizer log add --description "General reflection on the day" --type journal \
  --timestamp "14-11-2026 22:00" --timezone America/Port_of_Spain
```

Malformed dates, impossible calendar values, unknown timezones, nonexistent daylight-saving times, and ambiguous repeated times are rejected with a correction hint. For an ambiguous time, use ISO 8601 with an explicit offset.

List and search by local day, absolute range, type, and text:

```sh
life-optimizer log list --date 14-11-2026
life-optimizer log list --from 01-11-2026 --to 14-11-2026 --type health --limit 100 --order asc
life-optimizer log search --query headache --from 01-11-2026 --to 14-11-2026
```

Store general key-value facts in the same searchable timeline:

```sh
life-optimizer metadata add --key screen-time --value 15h \
  --timestamp "14-11-2026 23:00" --timezone America/Port_of_Spain
```

Import raw notes through local AI. `--date` is the reference for relative phrases such as “yesterday.” The model splits every distinct action, event, observation, or state change into a separate log—even when several appear in one sentence—and rewrites descriptions with corrected spelling, grammar, punctuation, and clearer wording without changing or inventing facts. Output is schema-checked, domain-validated, and retried with the validation issue before any database write.

```sh
life-optimizer log import --date 14-11-2026 --timezone America/Port_of_Spain \
  --text "7:30 woke with a headache. 9 took 500mg. Met Sam for lunch at 12:15." \
  --retries 3
```

Ask local AI about a bounded selection. Supporting instances are cited by log ID. If the row limit is reached or serialized context is too large, the command refuses an incomplete request and asks you to narrow the range, type, or text filter.

```sh
life-optimizer log ask --question "When did headaches occur and what did I log afterward?" \
  --from 01-11-2026 --to 14-11-2026 --type health --limit 200
```

Run the conversational agent with streamed responses and visible life-log/web sources. It can search logs using ranges, filters, limits, and regex; explicitly requested writes are audited, and corrections are restricted to logs created by the same chat session.

```sh
life-optimizer agent chat
life-optimizer agent chat --message "Find mentions of chest discomfort this week"
```

Agent chat currently requires the OpenAI provider because web search and the tool loop use the Responses API. Session messages, tool actions, sources, token totals, and estimated cost are saved locally in private JSON files. Patron gives the local user a $5 AI allowance, warns at 10% remaining, and uses a cheaper compatible model when constrained; see the getting-started guide for details.

Every command accepts `--json` for machine-readable output and `--help` for its complete flag reference.

## AI configuration

The database migrations register `ollama-qwen-agent-32k` (local `qwen-agent:32k`) and `openai-gpt-4.1-mini`. With the default `auto` provider, a configured OpenAI key is preferred; otherwise inference remains local. Defaults can be overridden without storing credentials:

```sh
export OLLAMA_ENDPOINT=http://localhost:11434
export LIFE_OPTIMIZER_AI_PROVIDER=auto
# Optional: enables OpenAI and sends AI-import/ask content to OpenAI.
export OPENAI_API_KEY=your-api-key
export LIFE_OPTIMIZER_TIME_ZONE=America/Port_of_Spain
```

## Verification

```sh
pnpm verify
pnpm test:db
```

GitHub Actions runs TypeScript builds/checks, unit tests, PostgreSQL 17 integration tests, the CLI smoke test, and the Docker build/test path.

## License

Licensed under the PolyForm Noncommercial License 1.0.0. See [LICENSE](LICENSE).
