# Life Optimizer agent

This package runs a bounded tool loop over `@life-optimizer/ai`. It can search the web, search a user's life logs (including validated regex filters), create logs after an explicit request, and correct only logs created by the same agent session.

Life-log sources are displayed as their local timestamp followed by a whitespace-normalized description truncated to 96 Unicode characters. The category is kept in the tool data for reasoning and filtering, but is not used as the human-facing source label.

Conversation messages, tool usage, sources, action outcomes, token totals, and estimated cost are persisted through the storage package's `TextDocumentStore`. The local CLI uses atomic, owner-only JSON files. Future computer, messaging, and email tools can be added as explicit tool definitions and executors without moving authorization rules out of core.

The agent exposes a timezone-aware current-date tool and tells the model to call it before resolving relative phrases such as “today” or “yesterday.” A failed function tool is returned to the model as structured `ok: false` output with the bounded validation message. The model can correct its arguments and retry up to three times; each failed and successful attempt remains visible in the session action history.

The agent also defines argv-based `run_command` and `run_life_optimizer_cli` tools. It never imports process or filesystem APIs: the CLI adapter owns execution. Commands use `spawn` without a shell, have a 120-second maximum timeout, and return at most 20,000 characters from each output stream. Nested `agent chat` calls, more than four actions in one turn, and an identical repeated action are rejected as non-retryable loop risks.

Human approval is default-deny. Every command, CLI invocation, life-log creation, and life-log update requires a one-time approval callback. When there is no interactive approval channel—or the person answers anything except `y` or `yes`—the action is not executed. A denied action is non-retryable; a correctable execution or validation error is returned to the model and may be retried within the bounded retry limit.

Patron wraps hosted AI usage. The default local configuration gives each user a $5 allowance, records estimated token and hosted-web-search cost, warns in the response at 10% remaining, selects the cheapest compatible model from the same provider when constrained, and blocks new model requests when exhausted. The OpenAI catalog currently downgrades `gpt-4.1-mini` to the tool-capable `gpt-4o-mini` when that path is available. Budget warnings, exhaustion, and model downgrades are operational events; prompts and responses are not included in those logs.
