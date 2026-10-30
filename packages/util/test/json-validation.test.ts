import { describe, expect, it } from "vitest";
import { isJsonValue, validateJson } from "../src/index.js";

describe("JSON validation", () => {
  it("rejects non-JSON values and cycles", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(isJsonValue({ at: new Date() })).toBe(false);
    expect(isJsonValue(circular)).toBe(false);
  });
  it("validates required structured output without allowing extra fields", () => {
    const schema = {
      type: "object",
      required: ["answer"],
      properties: { answer: { type: "string" } },
      additionalProperties: false,
    } as const;
    expect(validateJson(schema, { answer: "yes" })).toEqual([]);
    expect(validateJson(schema, { answer: 1, secret: true })).toEqual([
      "$.answer must be string",
      "$.secret is not allowed",
    ]);
  });
});
