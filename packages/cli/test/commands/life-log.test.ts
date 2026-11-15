import { describe, expect, it } from "vitest";
import type { LifeLog } from "@life-optimizer/core";
import { main } from "../../src/main.js";
import { testDeps } from "../helpers.js";
import {
  defaultAiModel,
  resolveAiModel,
} from "../../src/commands/life-log/ai-model.js";

const log = (overrides: Partial<LifeLog> = {}): LifeLog => ({
  id: "22222222-2222-7222-8222-222222222222",
  userId: "11111111-1111-4111-8111-111111111111",
  description: "Walked in the park",
  type: "exercise",
  occurredAt: new Date("2026-11-14T13:30:00Z"),
  timeZone: "America/Port_of_Spain",
  localDate: "2026-11-14",
  localTime: "09:30:00",
  metadataKey: null,
  metadataValue: null,
  agentSessionId: null,
  createdAt: new Date("2026-11-14T13:31:00Z"),
  ...overrides,
});

describe("life-log commands", () => {
  it("prefers OpenAI when an API key is configured and retains a forced local choice", () => {
    expect(defaultAiModel({ OPENAI_API_KEY: "key" })).toBe(
      "openai-gpt-4.1-mini",
    );
    expect(
      defaultAiModel({
        OPENAI_API_KEY: "key",
        LIFE_OPTIMIZER_AI_PROVIDER: "ollama",
      }),
    ).toBe("ollama-qwen-agent-32k");
    expect(resolveAiModel("gpt-4.1-mini", {})).toBe("openai-gpt-4.1-mini");
  });

  it("adds a log with an optional local timestamp", async () => {
    const t = testDeps();
    t.core.lifeLogs.add.mockResolvedValue([log()]);
    await expect(
      main(
        [
          "log",
          "add",
          "--description",
          "Walked in the park",
          "--type",
          "exercise",
          "--timestamp",
          "14-11-2026 09:30",
          "--timezone",
          "America/Port_of_Spain",
        ],
        t.deps,
      ),
    ).resolves.toBe(0);
    expect(t.core.lifeLogs.add).toHaveBeenCalledWith(
      expect.objectContaining({
        logs: [
          expect.objectContaining({
            timestamp: "14-11-2026 09:30",
            timeZone: "America/Port_of_Spain",
          }),
        ],
      }),
    );
  });
  it("searches text inside a time range", async () => {
    const t = testDeps();
    t.core.lifeLogs.list.mockResolvedValue([log()]);
    await main(
      [
        "log",
        "search",
        "--query",
        "park",
        "--from",
        "14-11-2026",
        "--to",
        "14-11-2026",
        "--timezone",
        "UTC",
      ],
      t.deps,
    );
    expect(t.core.lifeLogs.list).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "park",
        from: new Date("2026-11-14T00:00:00Z"),
        to: new Date("2026-11-14T23:59:59Z"),
      }),
    );
  });
  it("lists logs by occurrence time with a concise default display", async () => {
    const t = testDeps();
    t.core.lifeLogs.list.mockResolvedValue([log()]);

    await main(["log", "list", "--order", "asc"], t.deps);

    expect(t.core.lifeLogs.list).toHaveBeenCalledWith(
      expect.objectContaining({ order: "asc" }),
    );
    expect(t.stdout()).toContain("TIME");
    expect(t.stdout()).toContain("TYPE");
    expect(t.stdout()).toContain("DESCRIPTION");
    expect(t.stdout()).toContain("2026-11-14 09:30:00");
    expect(t.stdout()).toContain("Walked in the park");
    expect(t.stdout()).not.toContain("TIMEZONE");
    expect(t.stdout()).not.toContain("America/Port_of_Spain");
    expect(t.stdout()).not.toContain(log().id);
  });
  it("shows life-log IDs and timezones only when requested", async () => {
    const t = testDeps();
    t.core.lifeLogs.list.mockResolvedValue([log()]);

    await main(["log", "list", "--show-id", "--show-timezone"], t.deps);

    expect(t.stdout()).toContain("TIMEZONE");
    expect(t.stdout()).toContain("America/Port_of_Spain");
    expect(t.stdout()).toContain(log().id);
  });
  it("retries invalid AI import output and persists only validated logs", async () => {
    const t = testDeps();
    t.ai.complete
      .mockResolvedValueOnce({
        text: "bad",
        structuredOutput: {
          logs: [{ description: "x", type: "health", timestamp: "not-time" }],
        },
      })
      .mockResolvedValueOnce({
        text: "ok",
        structuredOutput: {
          logs: [
            {
              description: "Headache",
              type: "health",
              timestamp: "14-11-2026 08:00:00",
            },
          ],
        },
      });
    t.core.lifeLogs.add.mockResolvedValue([
      log({ description: "Headache", type: "health", localTime: "08:00:00" }),
    ]);
    await expect(
      main(
        [
          "log",
          "import",
          "--text",
          "8am headache",
          "--date",
          "14-11-2026",
          "--timezone",
          "UTC",
        ],
        t.deps,
      ),
    ).resolves.toBe(0);
    expect(t.ai.complete).toHaveBeenCalledTimes(2);
    expect(t.core.lifeLogs.add).toHaveBeenCalledTimes(1);
    const request = t.ai.complete.mock.calls[0]![1];
    expect(request.messages[0]?.content).toContain(
      "one log for each distinct action",
    );
    expect(request.messages[0]?.content).toContain(
      "Correct spelling, capitalization, punctuation",
    );
    expect(request.messages[0]?.content).toContain(
      '"Woke up with a headache."',
    );
    expect(request.messages[0]?.content).toContain(
      "health, medication, food, exercise",
    );
    expect(request.messages[0]?.content).toContain(
      "three separate logs: prayer, visualization, and manifestation",
    );
    expect(request.jsonSchema).toMatchObject({
      properties: {
        logs: {
          items: {
            properties: {
              type: {
                enum: expect.arrayContaining([
                  "exercise",
                  "travel",
                  "dream",
                  "visualization",
                  "manifestation",
                  "prayer",
                  "idea",
                ]),
              },
            },
          },
        },
      },
    });
  });
  it("suggests a close category for a mistyped direct input", async () => {
    const t = testDeps();

    await expect(
      main(
        [
          "log",
          "add",
          "--description",
          "Lifted weights",
          "--type",
          "excercise",
        ],
        t.deps,
      ),
    ).resolves.toBe(2);

    expect(t.stderr()).toContain('Did you mean "exercise"?');
    expect(t.stderr()).toContain("Available categories:");
    expect(t.core.lifeLogs.add).not.toHaveBeenCalled();
  });
  it("shows all categories when no close direct-input match exists", async () => {
    const t = testDeps();

    await expect(
      main(["log", "list", "--type", "completely-unknown"], t.deps),
    ).resolves.toBe(2);

    expect(t.stderr()).toContain("Available categories:");
    expect(t.stderr()).toContain("metadata");
    expect(t.stderr()).not.toContain("Did you mean");
    expect(t.core.lifeLogs.list).not.toHaveBeenCalled();
  });
  it("directs metadata log input to the dedicated command", async () => {
    const t = testDeps();

    await expect(
      main(
        [
          "log",
          "add",
          "--description",
          "Screen time: 15h",
          "--type",
          "metadata",
        ],
        t.deps,
      ),
    ).resolves.toBe(2);

    expect(t.stderr()).toContain("life-optimizer metadata add");
    expect(t.core.lifeLogs.add).not.toHaveBeenCalled();
  });
  it("does not retry a missing model configuration", async () => {
    const t = testDeps();
    t.ai.complete.mockRejectedValue(new Error("Unknown AI model: missing"));

    await expect(
      main(
        ["log", "import", "--text", "8am headache", "--date", "14-11-2026"],
        t.deps,
      ),
    ).resolves.toBe(1);

    expect(t.ai.complete).toHaveBeenCalledTimes(1);
    expect(t.stderr()).toContain("Unknown AI model: missing");
  });
  it("refuses an incomplete AI review selection at the requested limit", async () => {
    const t = testDeps();
    t.core.lifeLogs.list.mockResolvedValue([log()]);
    await expect(
      main(
        ["log", "ask", "--question", "When did I walk?", "--limit", "1"],
        t.deps,
      ),
    ).resolves.toBe(2);
    expect(t.stderr()).toContain("selection reached the --limit");
    expect(t.ai.complete).not.toHaveBeenCalled();
  });
  it("stores metadata as a searchable life log", async () => {
    const t = testDeps();
    t.core.lifeLogs.add.mockResolvedValue([
      log({
        type: "metadata",
        description: "screen-time: 15h",
        metadataKey: "screen-time",
        metadataValue: "15h",
      }),
    ]);
    await main(
      [
        "metadata",
        "add",
        "--key",
        "screen-time",
        "--value",
        "15h",
        "--timezone",
        "UTC",
      ],
      t.deps,
    );
    expect(t.core.lifeLogs.add).toHaveBeenCalledWith(
      expect.objectContaining({
        logs: [
          expect.objectContaining({
            type: "metadata",
            metadataKey: "screen-time",
            metadataValue: "15h",
          }),
        ],
      }),
    );
  });
});
