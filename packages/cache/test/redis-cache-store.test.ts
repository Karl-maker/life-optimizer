import { describe, expect, it, vi } from "vitest";
import {
  RedisCacheStore,
  type RedisCommands,
} from "../src/redis-cache-store.js";

describe("RedisCacheStore", () => {
  it("uses PX for TTL and cursor scanning for prefix invalidation", async () => {
    const client: RedisCommands = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(async (keys) => (Array.isArray(keys) ? keys.length : 1)),
      close: vi.fn(),
      async *scanIterator(options) {
        expect(options).toEqual({ MATCH: "lesson:*", COUNT: 2 });
        yield "lesson:1";
        yield "lesson:2";
        yield "lesson:3";
      },
    };
    const store = new RedisCacheStore(client, 2);
    await store.set("lesson:1", "value", { ttlMs: 250, priority: 0 });
    await expect(store.deleteByPrefix("lesson:")).resolves.toBe(3);
    expect(client.set).toHaveBeenCalledWith("lesson:1", "value", { PX: 250 });
    expect(client.del).toHaveBeenCalledWith(["lesson:1", "lesson:2"]);
    expect(client.del).toHaveBeenCalledWith(["lesson:3"]);
  });
});
