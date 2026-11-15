# `@life-optimizer/observability`

Shared, vendor-neutral structured operational telemetry for Life Optimizer.

Create one `Telemetry` instance at an application composition root and give it one or more `EventSink` adapters. Events contain a timestamp, level, stable dotted name, service, optional correlation ID, and safe scalar attributes. Delivery is asynchronous and best effort: a failed sink is reported through `onSinkError` but never changes business behaviour.

Use `createLocalFileSink` for JSONL retention, `createJsonLinesSink` for a stream or collector, and `createHttpSink` for a trusted receiver. Add a new destination by implementing `EventSink`; it must tolerate duplicate deliveries. See [`docs/observability.md`](../../docs/observability.md) for configuration and the boundary between diagnostics and the durable audit trail.
