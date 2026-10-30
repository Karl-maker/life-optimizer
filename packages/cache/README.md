# Cache

`@edu-service/cache` provides cache-aside coordination outside the domain layer. Cache entries are never a source of truth: a failed cache read, write, invalidation, or pre-warm always falls back to the loader and therefore must not change learning rules or authorization decisions.

## Use it

Compose one cache at the outer application boundary and pass the existing operational log so hit, miss, write, invalidation, pre-warm, capacity-eviction, and failure events reach the normal telemetry sinks. Event attributes intentionally contain only the bounded key namespace, TTL, priority, count, and duration — never a cache key or value.

```ts
import { createCache, InMemoryCacheStore } from "@edu-service/cache";

const cache = createCache({
  store: new InMemoryCacheStore({ maxEntries: 10_000 }),
  defaultTtlMs: 60_000,
  operationLog,
});

const lesson = await cache.getOrLoad(
  `lesson:${lessonId}`,
  () => lessons.findById(lessonId),
  { ttlMs: 60_000, priority: 10, correlationId },
);

// After a successful source-of-truth change, invalidate the exact key or namespace.
await cache.invalidate(`lesson:${lessonId}`, correlationId);
```

`getOrLoad` coalesces concurrent requests for the same in-process key, which prevents a cold-key stampede in one process. Invalidate only after the database transaction commits; do not make cache invalidation part of domain state or an audit event.

## In-memory capacity and priority

`InMemoryCacheStore` is process-local and best for tests, development, or a single-process deployment. When `maxEntries` is reached it removes the entry with the lowest explicit `priority`; ties use the least access count (LFU), then least-recent access (LRU). The default priority is `0`; higher integers protect genuinely important, high-cost-to-load data. TTL expiry always removes an entry before capacity ranking.

This deterministic policy makes intentional priority visible in code. It does not attempt to reproduce a distributed cache policy across processes. For a large cache, use Redis with an independent cache-only instance, a `maxmemory` limit, and `maxmemory-policy allkeys-lfu`. Redis uses an approximate, decaying LFU counter so items that stop being popular can eventually be displaced. Do not try to enforce per-entry application priority with Redis `SCAN`/manual deletion: it is racy, costly, and duplicates Redis's purpose-built eviction machinery.

## Redis

`RedisCacheStore` accepts the small `RedisCommands` surface rather than taking a dependency on a particular Redis client. Create and connect the client at the composition root, validate `EDU_CACHE_REDIS_URL` with `readRedisCacheConfiguration`, then pass it to the adapter. The cache package never logs the connection URL.

```ts
import { createClient } from "redis";
import {
  createCache,
  readRedisCacheConfiguration,
  RedisCacheStore,
} from "@edu-service/cache";

const { url } = readRedisCacheConfiguration(process.env);
const client = createClient({ url });
await client.connect();
const cache = createCache({
  store: new RedisCacheStore(client),
  defaultTtlMs: 60_000,
  operationLog,
});
```

The Redis adapter writes TTLs with `PX` and invalidates namespaces with cursor-based `SCAN`, never blocking `KEYS`. Its `priority` option is retained in the cache API for parity but capacity eviction is configured on the Redis server, not by the adapter. Use a dedicated cache instance where possible so `allkeys-lfu` can evict every cache key safely; on a shared Redis instance, `volatile-lfu` only considers keys with a TTL and can fail to reclaim enough space if non-cache keys dominate.

For local development, `pnpm cache:up` starts Redis on port 6379 with a disposable 256 MB cache and `allkeys-lfu`; copy this package's `.env.example` to an ignored `.env` if your composition root loads environment files. `pnpm cache:down` stops it. The local container deliberately disables persistence because cache entries must always be reloadable from their source of truth.

## Pre-warm selectively

At startup, pre-warm only small, stable, frequently used reference data (for example, a public course catalog or country list). Call the same `getOrLoad` functions used by normal reads; that keeps serialization, TTL, priority, and telemetry identical. `prewarm` runs tasks sequentially deliberately, avoiding a startup burst against PostgreSQL.

```ts
await cache.prewarm(
  [
    {
      name: "public-course-catalog",
      run: () =>
        cache
          .getOrLoad("catalog:public", () => courses.listPublic(), {
            ttlMs: 5 * 60_000,
            priority: 10,
            correlationId: startupCorrelationId,
          })
          .then(() => undefined),
    },
  ],
  startupCorrelationId,
);
```

Keep readiness independent from optional warming: a failed warm logs `cache.prewarm.failed` and normal cache-aside reads still work. Measure hit/miss and eviction event rates first; warm only keys with demonstrated steady demand, cap the warm set, and use a jittered/background refresh for expensive or frequently changing data.
