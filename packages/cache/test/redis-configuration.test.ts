import { describe, expect, it } from "vitest";
import { readRedisCacheConfiguration } from "../src/redis-configuration.js";

describe("readRedisCacheConfiguration", () => {
  it("accepts Redis URLs without exposing them in errors", () => {
    expect(
      readRedisCacheConfiguration({
        EDU_CACHE_REDIS_URL: "rediss://cache.example.test:6380/0",
      }),
    ).toEqual({ url: "rediss://cache.example.test:6380/0" });
  });

  it("rejects missing, malformed, and non-Redis URLs", () => {
    expect(() => readRedisCacheConfiguration({})).toThrow(
      "EDU_CACHE_REDIS_URL is required",
    );
    expect(() =>
      readRedisCacheConfiguration({ EDU_CACHE_REDIS_URL: "not a URL" }),
    ).toThrow("valid redis");
    expect(() =>
      readRedisCacheConfiguration({
        EDU_CACHE_REDIS_URL: "https://cache.example.test",
      }),
    ).toThrow("redis://");
  });
});
