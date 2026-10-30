import * as fs from "node:fs/promises";
import path from "node:path";

export type EventLevel = "debug" | "info" | "warn" | "error";
export type EventAttributes = Record<string, string | number | boolean | null>;

export interface OperationalEvent {
  timestamp: string;
  level: EventLevel;
  name: string;
  service: string;
  correlationId?: string;
  attributes: EventAttributes;
}

/** A destination for operational events. Sinks must be safe to retry. */
export interface EventSink {
  emit(event: OperationalEvent): Promise<void>;
  flush?(): Promise<void>;
}

export interface Telemetry {
  debug(name: string, attributes?: EventAttributes, correlationId?: string): void;
  info(name: string, attributes?: EventAttributes, correlationId?: string): void;
  warn(name: string, attributes?: EventAttributes, correlationId?: string): void;
  error(name: string, attributes?: EventAttributes, correlationId?: string): void;
  flush(): Promise<void>;
}

/** The small filesystem surface required by the JSONL file adapter. */
export interface LocalFileSystem {
  appendFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
}

const SENSITIVE_ATTRIBUTE =
  /password|secret|token|authorization|cookie|connection.?string|database.?url/i;

function sanitize(attributes: EventAttributes): EventAttributes {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      SENSITIVE_ATTRIBUTE.test(key) ? "[REDACTED]" : value,
    ]),
  );
}

/**
 * Emits structured operational events to one or more independent sinks. A sink
 * failure is reported through `onSinkError` and never changes application flow.
 */
export function createTelemetry(options: {
  service: string;
  sinks: readonly EventSink[];
  now?: () => Date;
  onSinkError?: (error: unknown, event: OperationalEvent) => void;
}): Telemetry {
  const now = options.now ?? (() => new Date());
  const pending = new Set<Promise<void>>();
  const reportSinkError = (error: unknown, event: OperationalEvent) => {
    // Observability must remain non-invasive even when its own reporter is faulty.
    try {
      options.onSinkError?.(error, event);
    } catch {
      // Intentionally ignored: callers must not lose business work to telemetry.
    }
  };

  const emit = (
    level: EventLevel,
    name: string,
    attributes: EventAttributes = {},
    correlationId?: string,
  ) => {
    const event: OperationalEvent = {
      timestamp: now().toISOString(),
      level,
      name,
      service: options.service,
      ...(correlationId === undefined ? {} : { correlationId }),
      attributes: sanitize(attributes),
    };
    for (const sink of options.sinks) {
      const delivery = sink.emit(event).catch((error: unknown) => {
        reportSinkError(error, event);
      });
      pending.add(delivery);
      void delivery.finally(() => pending.delete(delivery));
    }
  };

  return {
    debug: (name, attributes, correlationId) =>
      emit("debug", name, attributes, correlationId),
    info: (name, attributes, correlationId) =>
      emit("info", name, attributes, correlationId),
    warn: (name, attributes, correlationId) =>
      emit("warn", name, attributes, correlationId),
    error: (name, attributes, correlationId) =>
      emit("error", name, attributes, correlationId),
    async flush() {
      await Promise.all([...pending]);
      await Promise.all(
        options.sinks.map(async (sink) => {
          try {
            await sink.flush?.();
          } catch (error) {
            reportSinkError(error, {
              timestamp: now().toISOString(),
              level: "error",
              name: "telemetry.flush.failed",
              service: options.service,
              attributes: {},
            });
          }
        }),
      );
    },
  };
}

/** Emits one JSON object per line, suitable for stderr, a pipe, or a collector. */
export function createJsonLinesSink(write: (line: string) => void): EventSink {
  return { emit: async (event) => write(`${JSON.stringify(event)}\n`) };
}

/** Appends JSON Lines to a local path, creating its parent directory when needed. */
export function createLocalFileSink(options: {
  filePath: string;
  fs?: LocalFileSystem;
}): EventSink {
  const fileSystem: LocalFileSystem = options.fs ?? fs;
  let ready: Promise<unknown> | undefined;
  return {
    async emit(event) {
      ready ??= fileSystem.mkdir(path.dirname(options.filePath), { recursive: true });
      await ready;
      await fileSystem.appendFile(
        options.filePath,
        `${JSON.stringify(event)}\n`,
        "utf8",
      );
    },
  };
}

/** Sends one event per request to a trusted third-party or self-hosted endpoint. */
export function createHttpSink(options: {
  endpoint: string;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}): EventSink {
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    async emit(event) {
      const response = await fetcher(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body: JSON.stringify(event),
      });
      if (!response.ok)
        throw new Error(`Telemetry endpoint returned HTTP ${response.status}.`);
    },
  };
}

/** Filters events before sending them to a particular destination. */
export function createFilteredSink(
  sink: EventSink,
  include: (event: OperationalEvent) => boolean,
): EventSink {
  return {
    emit: async (event) => {
      if (include(event)) await sink.emit(event);
    },
    ...(sink.flush === undefined ? {} : { flush: () => sink.flush!() }),
  };
}
