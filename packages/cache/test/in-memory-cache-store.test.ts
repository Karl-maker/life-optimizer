import { describe, expect, it } from "vitest";
import { InMemoryCacheStore } from "../src/in-memory-cache-store.js";

describe("InMemoryCacheStore", () => {
  it("expires entries using their TTL", async () => {
    let now = 0;
    const store = new InMemoryCacheStore({ now: () => now });
    await store.set("lesson:1", "value", { ttlMs: 10, priority: 0 });
    now = 10;
    await expect(store.get("lesson:1")).resolves.toBeNull();
  });

  it("evicts lower priority before a frequently used higher-priority entry", async () => {
    let now = 0;
    const store = new InMemoryCacheStore({ maxEntries: 2, now: () => ++now });
    await store.set("lesson:important", "keep", { ttlMs: 100, priority: 10 });
    await store.get("lesson:important");
    await store.set("lesson:low", "remove", { ttlMs: 100, priority: 0 });
    await expect(
      store.set("lesson:new", "new", { ttlMs: 100, priority: 0 }),
    ).resolves.toEqual({ evicted: 1 });
    await expect(store.get("lesson:important")).resolves.toBe("keep");
    await expect(store.get("lesson:low")).resolves.toBeNull();
  });

  it("uses access count and then recency to choose equal-priority victims", async () => {
    let now = 0;
    const store = new InMemoryCacheStore({ maxEntries: 2, now: () => ++now });
    await store.set("lesson:used", "keep", { ttlMs: 100, priority: 0 });
    await store.set("lesson:cold", "remove", { ttlMs: 100, priority: 0 });
    await store.get("lesson:used");
    await store.set("lesson:new", "new", { ttlMs: 100, priority: 0 });
    await expect(store.get("lesson:used")).resolves.toBe("keep");
    await expect(store.get("lesson:cold")).resolves.toBeNull();
  });
});
