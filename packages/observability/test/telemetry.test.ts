import { describe, expect, it, vi } from "vitest";
import {
  createFilteredSink,
  createHttpSink,
  createJsonLinesSink,
  createLocalFileSink,
  createTelemetry,
  type EventSink,
} from "../src/index.js";

describe("telemetry", () => {
  it("emits structured events with a correlation id and redacts sensitive attributes", async () => {
    const events: unknown[] = [];
    const telemetry = createTelemetry({
      service: "test-service",
      now: () => new Date("2026-10-30T00:00:00.000Z"),
      sinks: [{ emit: async (event) => void events.push(event) }],
    });

    telemetry.info(
      "company.created",
      { companyId: "company-1", apiToken: "secret" },
      "request-1",
    );
    await telemetry.flush();

    expect(events).toEqual([
      {
        timestamp: "2026-10-30T00:00:00.000Z",
        level: "info",
        name: "company.created",
        service: "test-service",
        correlationId: "request-1",
        attributes: { companyId: "company-1", apiToken: "[REDACTED]" },
      },
    ]);
  });

  it("isolates a failed sink from the application and reports it", async () => {
    const onSinkError = vi.fn();
    const telemetry = createTelemetry({
      service: "test-service",
      sinks: [{ emit: async () => Promise.reject(new Error("offline")) }],
      onSinkError,
    });

    telemetry.error("command.failed");
    await telemetry.flush();

    expect(onSinkError).toHaveBeenCalledOnce();
  });

  it("isolates a failed flush from application shutdown", async () => {
    const onSinkError = vi.fn();
    const telemetry = createTelemetry({
      service: "test-service",
      sinks: [
        {
          emit: async () => undefined,
          flush: async () => Promise.reject(new Error("offline")),
        },
      ],
      onSinkError,
    });

    await expect(telemetry.flush()).resolves.toBeUndefined();
    expect(onSinkError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ name: "telemetry.flush.failed" }),
    );
  });

  it("writes JSON Lines and filters events for a destination", async () => {
    let output = "";
    const sink = createFilteredSink(
      createJsonLinesSink((line) => (output += line)),
      (event) => event.level === "error",
    );
    const telemetry = createTelemetry({
      service: "test-service",
      sinks: [sink],
    });

    telemetry.info("command.completed");
    telemetry.error("command.failed");
    await telemetry.flush();

    expect(JSON.parse(output)).toMatchObject({
      level: "error",
      name: "command.failed",
    });
  });

  it("posts structured JSON to an HTTP adapter", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    const sink: EventSink = createHttpSink({
      endpoint: "https://logs.example.test/events",
      headers: { authorization: "Bearer token" },
      fetch,
    });
    await sink.emit({
      timestamp: "now",
      level: "info",
      name: "event",
      service: "test",
      attributes: {},
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://logs.example.test/events",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"name":"event"'),
      }),
    );
  });

  it("creates a local destination once and appends JSON Lines", async () => {
    const appendFile = vi.fn(async () => undefined);
    const mkdir = vi.fn(async () => undefined);
    const sink = createLocalFileSink({
      filePath: "/var/log/life-optimizer/events.jsonl",
      fs: { appendFile, mkdir },
    });
    const event = {
      timestamp: "now",
      level: "info" as const,
      name: "event",
      service: "test",
      attributes: {},
    };

    await sink.emit(event);
    await sink.emit(event);

    expect(mkdir).toHaveBeenCalledOnce();
    expect(appendFile).toHaveBeenCalledTimes(2);
  });
});
