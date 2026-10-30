import { describe, expect, it } from "vitest";
import {
  createJsonLinesSink,
  createTelemetry,
} from "../../src/observability/logger.js";

describe("CLI telemetry", () => {
  it("writes one structured, newline-delimited record", async () => {
    let output = "";
    const telemetry = createTelemetry({
      service: "test-cli",
      sinks: [createJsonLinesSink((line) => void (output += line))],
      now: () => new Date("2026-10-29T09:00:00Z"),
    });

    telemetry.info("command.completed", { count: 1 }, "abc");
    await telemetry.flush();

    expect(output).toBe(
      '{"timestamp":"2026-10-29T09:00:00.000Z","level":"info","name":"command.completed","service":"test-cli","correlationId":"abc","attributes":{"count":1}}\n',
    );
  });
});
