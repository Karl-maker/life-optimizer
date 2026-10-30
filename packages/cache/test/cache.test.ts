import { describe, expect, it, vi } from "vitest";
import type { OperationLog } from "@edu-service/core";
import { createCache } from "../src/cache.js";
import { InMemoryCacheStore } from "../src/in-memory-cache-store.js";

function log(): OperationLog & { events: ReturnType<typeof vi.fn> } {
  const events = vi.fn();
  return { events, info: events, error: events };
}

describe("createCache", () => {
  it("uses cache-aside reads, TTL expiry, and hit/miss events", async () => {
    let now = 0;
    const operationLog = log();
    const cache = createCache({
      store: new InMemoryCacheStore({ now: () => now }),
      defaultTtlMs: 10,
      operationLog,
    });
    const load = vi.fn(async () => ({ title: "Frequently used lesson" }));
    await expect(
      cache.getOrLoad("lesson:1", load, { correlationId: "c1" }),
    ).resolves.toEqual({ title: "Frequently used lesson" });
    await cache.getOrLoad("lesson:1", load, { correlationId: "c1" });
    now = 10;
    await cache.getOrLoad("lesson:1", load, { correlationId: "c1" });
    expect(load).toHaveBeenCalledTimes(2);
    expect(operationLog.events).toHaveBeenCalledWith(
      "cache.miss",
      { namespace: "lesson" },
      "c1",
    );
    expect(operationLog.events).toHaveBeenCalledWith(
      "cache.hit",
      { namespace: "lesson" },
      "c1",
    );
  });

  it("shares simultaneous misses and allows explicit invalidation", async () => {
    const cache = createCache({
      store: new InMemoryCacheStore(),
      defaultTtlMs: 100,
    });
    const load = vi.fn(async () => "value");
    await Promise.all([
      cache.getOrLoad("catalog:all", load),
      cache.getOrLoad("catalog:all", load),
    ]);
    await cache.invalidatePrefix("catalog:");
    await cache.getOrLoad("catalog:all", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not let cache storage failures prevent a source read", async () => {
    const cache = createCache({
      store: {
        get: vi.fn(async () => {
          throw new Error("down");
        }),
        set: vi.fn(async () => ({ evicted: 0 })),
        delete: vi.fn(),
        deleteByPrefix: vi.fn(),
      },
      defaultTtlMs: 100,
    });
    await expect(
      cache.getOrLoad("lesson:1", async () => "source of truth"),
    ).resolves.toBe("source of truth");
  });

  it("rejects invalid TTLs", () => {
    expect(() =>
      createCache({ store: new InMemoryCacheStore(), defaultTtlMs: 0 }),
    ).toThrow("positive");
  });

  it("rejects a non-integer priority before writing", async () => {
    const store = new InMemoryCacheStore();
    const cache = createCache({ store, defaultTtlMs: 100 });
    await expect(
      cache.set("lesson:1", "value", { priority: 0.5 }),
    ).rejects.toThrow("priority");
    await expect(store.get("lesson:1")).resolves.toBeNull();
  });

  it("logs a capacity eviction without exposing cache keys", async () => {
    const operationLog = log();
    const cache = createCache({
      store: new InMemoryCacheStore({ maxEntries: 1 }),
      defaultTtlMs: 100,
      operationLog,
    });
    await cache.set("lesson:one", "one");
    await cache.set("lesson:two", "two", { correlationId: "c1" });
    expect(operationLog.events).toHaveBeenCalledWith(
      "cache.evicted",
      { namespace: "lesson", count: 1, reason: "capacity" },
      "c1",
    );
  });
});
