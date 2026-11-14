# `@life-optimizer/cli`

This package is the command-line adapter for Life Optimizer. Run it from the workspace as `pnpm life-optimizer <command>` or use the packaged `life-optimizer` executable.

## Role in the architecture

The CLI is deliberately thin. It accepts command input, validates it, calls the public API exposed by `packages/core`, and renders a result for people or scripts.

It must not contain life-log rules, persistence rules, or authorization decisions that belong in core. That keeps the same use cases available to future adapters.

```
command input → CLI parsing and presentation → core use case → port → database adapter
```

## Source layout

| Path                 | Responsibility                                               |
| -------------------- | ------------------------------------------------------------ |
| `src/bin.ts`         | Process entry point and exit-code handling.                  |
| `src/main.ts`        | Testable command lifecycle.                                  |
| `src/commands/`      | Command definitions that invoke core use cases.              |
| `src/framework/`     | Shared command parsing and command-definition utilities.     |
| `src/output/`        | Human-readable and machine-readable rendering.               |
| `src/errors/`        | Translation of domain and unexpected errors into CLI output. |
| `src/config/`        | Local CLI configuration only.                                |
| `src/observability/` | Safe operational logging.                                    |
| `test/`              | Unit and end-to-end tests for CLI behaviour.                 |

## Rules for changes

- Keep commands focused on input, calling core, and output; do not recreate a core use case in a command.
- Use shared parsing, rendering, error, and configuration utilities before adding new ones.
- Preserve the separation of stdout for primary output and stderr for diagnostics.
- Add tests for successful use, invalid input, expected errors, and machine-readable output when a command changes.
- Run the relevant package tests while iterating and `pnpm verify` before handoff. CI also runs the compiled CLI smoke test.

The repository-wide quality and architecture rules are in [AGENTS.md](../../AGENTS.md).

## API login

`life-optimizer auth login --api-url <https-url> --email <address>` reads the password from a hidden terminal prompt and stores only the returned opaque, revocable session in the mode-0600 CLI config. Passwords are never accepted as flags or written to configuration.

## Life logs

The supported log, journal, metadata, AI import, AI review, date/time, timezone, and search examples are documented in the repository [README](../../README.md). Run `life-optimizer <command> --help` for the generated flag contract.
