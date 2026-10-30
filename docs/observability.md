# Observability and audit architecture

Edu Service uses two deliberately separate records:

| Record               | Purpose                                                                                | Delivery guarantee                                                |
| -------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Business audit event | Evidence of a meaningful state change: who did what, to which resource, when, and why. | Transactional and append-only in PostgreSQL.                      |
| Operational event    | Diagnose command flow, errors, dependencies, latency, and service health.              | Best effort; a sink failure never changes user-visible behaviour. |

This split follows the pattern used by large hosted platforms: audit records are durable and queryable, while structured events may be streamed to a local or third-party observability system. [OpenTelemetry's semantic conventions](https://opentelemetry.io/docs/concepts/semantic-conventions/) and [log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) inform the event shape and correlation model. [GitLab's audit-event streaming design](https://docs.gitlab.com/user/compliance/audit_event_streaming/) demonstrates why destinations must receive structured, deduplicable events rather than database calls in a business transaction.

## Current implementation

- `@edu-service/core` writes company audits, and the AI catalog writes `ai.model.registered`, inside the same transaction as the change.
- PostgreSQL blocks updates and deletes from `audit_events` and indexes company, actor, resource, and correlation ID fields.
- `@edu-service/observability` emits structured events with `timestamp`, `level`, `name`, `service`, `correlationId`, and safe scalar attributes.
- `@edu-service/ai` emits `ai.request.succeeded`, `ai.request.failed`, `ai.image.succeeded`, and `ai.decision.succeeded` with model/provider IDs, duration, bounded token counts, and fallback status. Prompts, documents, outputs, credentials, and raw provider errors are never telemetry attributes.
- The CLI emits `command.completed` and `command.failed`; core emits `user.created`, `company.created`, and `company.archived`; the database emits successful and failed ping events.
- Attributes whose keys imply credentials or connection details are redacted before delivery.

## Local and external event sinks

The CLI can write JSON Lines to stderr, a local file, or an HTTP endpoint:

```sh
# Human- and collector-friendly stderr records
EDU_SERVICE_LOG_JSON=1 edu-service company list

# Local, append-only JSONL file
EDU_SERVICE_LOG_FILE=/var/log/edu-service/events.jsonl edu-service company list

# Trusted receiver for structured operational events
EDU_SERVICE_LOG_HTTP_ENDPOINT=https://telemetry.example.com/v1/events edu-service company list
```

Never place secrets, document contents, learning responses, or raw request bodies in event attributes. Use a stable resource ID, an event name, a correlation ID, and a safe classification instead.

## Adding instrumentation

1. Keep business state changes in core and append a durable audit event in the transaction.
2. Emit a separate operational event after the transaction commits, using a stable dotted name such as `content.published` or `share.invitation.accepted`.
3. Include the correlation ID supplied by the adapter. Include only safe, bounded attributes, for example `contentId`, `visibility`, `actorKind`, `durationMs`, or `errorCode`.
4. Add unit tests for the audit meaning and event shape. For database changes, add integration coverage for the transaction and audit row.
5. Add a short “how it works” snippet near the affected feature documentation.

## Extending sinks

`@edu-service/observability` exposes `EventSink`, an asynchronous `emit(event)` contract. Implement it for a collector, SIEM, or vendor SDK and pass it to `createTelemetry` at the composition root. Sinks must tolerate duplicate events and should not throw into application flow.

Use `createFilteredSink` to send only selected levels or event families to a destination. `createLocalFileSink` is for self-hosted JSONL retention. `createHttpSink` is a simple adapter for a trusted JSON receiver; give programmatic integrations explicit authentication headers instead of putting credentials in event payloads.

## Audit filtering and streaming roadmap

The audit table already carries the fields needed to filter by time range, company, actor, action, resource, or correlation ID. The next product API should expose a paginated `AuditReader` port with those exact filters and authorization checks; it must never expose raw audit rows directly from an adapter. For a multi-company system, authorize the requested company before querying and use a cursor based on `(occurredAt, id)` so pages remain stable when new events arrive.

Do not send audit events directly to an HTTP sink from the transaction. The production design is a transactional outbox: write the audit event and an outbox row in one transaction, then have a retrying worker deliver ordered, idempotent envelopes to sinks. That gives a reliable local record even when a third-party destination is unavailable.

## Feasibility decision

Adopt the current standalone package now: it has no vendor dependency, works locally, supports HTTP adapters, and keeps the event model compatible with later OpenTelemetry collection. Add OpenTelemetry SDK/exporter integration only when the service gains an API or worker process that benefits from distributed traces and metrics. Add the audit-reader and transactional-outbox capabilities before promising external audit streaming or security-operations guarantees. This also aligns with [GitHub's audit-log streaming guidance](https://docs.github.com/en/enterprise-cloud%40latest/admin/monitoring-activity-in-your-enterprise/reviewing-audit-logs-for-your-enterprise/streaming-the-audit-log-for-your-enterprise): delivery systems must be monitored and recipients should be treated as external security boundaries.
