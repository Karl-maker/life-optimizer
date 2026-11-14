import { describe, expect, it } from "vitest";
import {
  LIFE_LOG_TYPES,
  parseLifeLogTimestamp,
  parseLifeLogType,
} from "../../src/index.js";

describe("life-log timestamps", () => {
  it("parses a local timestamp, defaults seconds, and preserves its timezone", () => {
    expect(
      parseLifeLogTimestamp({
        timestamp: "14-11-2026 09:30",
        timeZone: "America/Port_of_Spain",
      }),
    ).toEqual({
      occurredAt: new Date("2026-11-14T13:30:00.000Z"),
      timeZone: "America/Port_of_Spain",
      localDate: "2026-11-14",
      localTime: "09:30:00",
    });
  });
  it("uses now and derives the local calendar values when timestamp is omitted", () => {
    expect(
      parseLifeLogTimestamp({
        timeZone: "Asia/Tokyo",
        now: new Date("2026-11-14T23:30:45Z"),
      }),
    ).toMatchObject({ localDate: "2026-11-15", localTime: "08:30:45" });
  });
  it.each(["31-02-2026 10:00", "14-11-2026 24:00", "2026/11/14 10:00"])(
    "rejects malformed time %s",
    (timestamp) => {
      expect(() =>
        parseLifeLogTimestamp({ timestamp, timeZone: "UTC" }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_TIMESTAMP" }));
    },
  );
  it("rejects nonexistent and ambiguous daylight-saving times", () => {
    expect(() =>
      parseLifeLogTimestamp({
        timestamp: "08-03-2026 02:30",
        timeZone: "America/New_York",
      }),
    ).toThrow(/does not exist/);
    expect(() =>
      parseLifeLogTimestamp({
        timestamp: "01-11-2026 01:30",
        timeZone: "America/New_York",
      }),
    ).toThrow(/occurs twice/);
  });
});

describe("life-log categories", () => {
  it("normalizes a supported category and exposes the stable category list", () => {
    expect(parseLifeLogType(" Exercise ")).toBe("exercise");
    expect(LIFE_LOG_TYPES).toContain("travel");
    expect(LIFE_LOG_TYPES).toEqual(
      expect.arrayContaining([
        "dream",
        "visualization",
        "manifestation",
        "prayer",
        "idea",
      ]),
    );
    expect(LIFE_LOG_TYPES).toContain("metadata");
  });

  it("rejects categories outside the stable list", () => {
    expect(() => parseLifeLogType("fitness")).toThrowError(
      expect.objectContaining({
        code: "INVALID_LIFE_LOG",
        message: expect.stringContaining("exercise"),
      }),
    );
  });
});
