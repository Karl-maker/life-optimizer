import type { CacheStore, OperationLog } from "@edu-service/core";

export interface Cache {
  get<T>(key: string, correlationId?: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: CacheWriteOptions): Promise<void>;
  getOrLoad<T>(
    key: string,
    load: () => Promise<T>,
    options?: CacheReadThroughOptions,
  ): Promise<T>;
  invalidate(key: string, correlationId?: string): Promise<void>;
  invalidatePrefix(prefix: string, correlationId?: string): Promise<number>;
  prewarm(
    tasks: readonly CachePrewarmTask[],
    correlationId?: string,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface CacheWriteOptions {
  ttlMs?: number;
  /** Higher values are retained first by bounded in-memory stores. Defaults to 0. */
  priority?: number;
  correlationId?: string;
}

export interface CacheReadThroughOptions extends CacheWriteOptions {}

export interface CachePrewarmTask {
  /** A stable, non-sensitive name used only in operational events. */
  name: string;
  run(): Promise<void>;
}

const NOOP_LOG: OperationLog = {
  info: () => undefined,
  error: () => undefined,
};

/**
 * Cache-aside coordinator. It degrades to the loader when the cache is
 * unavailable; cache failures never replace a successful source-of-truth read.
 */
export function createCache(options: {
  store: CacheStore;
  defaultTtlMs: number;
  operationLog?: OperationLog;
}): Cache {
  validateTtl(options.defaultTtlMs);
  const log = options.operationLog ?? NOOP_LOG;
  const inFlight = new Map<string, Promise<unknown>>();

  const get = async <T>(
    key: string,
    correlationId?: string,
  ): Promise<T | null> => {
    try {
      const raw = await options.store.get(key);
      if (raw === null) {
        log.info("cache.miss", scopeAttributes(key), correlationId);
        return null;
      }
      try {
        const value: unknown = JSON.parse(raw);
        log.info("cache.hit", scopeAttributes(key), correlationId);
        return value as T;
      } catch {
        await removeCorruptEntry(key, correlationId);
        return null;
      }
    } catch {
      log.error("cache.read.failed", scopeAttributes(key), correlationId);
      return null;
    }
  };

  const set = async <T>(
    key: string,
    value: T,
    writeOptions: CacheWriteOptions = {},
  ) => {
    const ttlMs = writeOptions.ttlMs ?? options.defaultTtlMs;
    validateTtl(ttlMs);
    const priority = writeOptions.priority ?? 0;
    validatePriority(priority);
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      log.error(
        "cache.serialize.failed",
        scopeAttributes(key),
        writeOptions.correlationId,
      );
      return;
    }
    if (serialized === undefined) {
      log.error(
        "cache.serialize.failed",
        scopeAttributes(key),
        writeOptions.correlationId,
      );
      return;
    }
    try {
      const result = await options.store.set(key, serialized, {
        ttlMs,
        priority,
      });
      log.info(
        "cache.stored",
        { ...scopeAttributes(key), ttlMs, priority },
        writeOptions.correlationId,
      );
      if (result.evicted > 0)
        log.info(
          "cache.evicted",
          {
            ...scopeAttributes(key),
            count: result.evicted,
            reason: "capacity",
          },
          writeOptions.correlationId,
        );
    } catch {
      log.error(
        "cache.write.failed",
        scopeAttributes(key),
        writeOptions.correlationId,
      );
    }
  };

  const removeCorruptEntry = async (key: string, correlationId?: string) => {
    log.error("cache.deserialize.failed", scopeAttributes(key), correlationId);
    try {
      await options.store.delete(key);
      log.info("cache.invalidated", scopeAttributes(key), correlationId);
    } catch {
      log.error("cache.invalidate.failed", scopeAttributes(key), correlationId);
    }
  };

  return {
    get,
    set,
    async getOrLoad<T>(
      key: string,
      load: () => Promise<T>,
      readOptions: CacheReadThroughOptions = {},
    ): Promise<T> {
      const hit = await get<T>(key, readOptions.correlationId);
      if (hit !== null) return hit;
      const current = inFlight.get(key) as Promise<T> | undefined;
      if (current) return current;
      const pending = load().then(async (value) => {
        await set(key, value, readOptions);
        return value;
      });
      inFlight.set(key, pending);
      try {
        return await pending;
      } finally {
        inFlight.delete(key);
      }
    },
    async invalidate(key, correlationId) {
      try {
        await options.store.delete(key);
        log.info("cache.invalidated", scopeAttributes(key), correlationId);
      } catch {
        log.error(
          "cache.invalidate.failed",
          scopeAttributes(key),
          correlationId,
        );
      }
    },
    async invalidatePrefix(prefix, correlationId) {
      try {
        const count = await options.store.deleteByPrefix(prefix);
        log.info(
          "cache.namespace.invalidated",
          { ...scopeAttributes(prefix), count },
          correlationId,
        );
        return count;
      } catch {
        log.error(
          "cache.namespace.invalidate.failed",
          scopeAttributes(prefix),
          correlationId,
        );
        return 0;
      }
    },
    async prewarm(tasks, correlationId) {
      for (const task of tasks) {
        const startedAt = Date.now();
        log.info("cache.prewarm.started", { task: task.name }, correlationId);
        try {
          await task.run();
          log.info(
            "cache.prewarm.succeeded",
            { task: task.name, durationMs: Date.now() - startedAt },
            correlationId,
          );
        } catch {
          log.error(
            "cache.prewarm.failed",
            { task: task.name, durationMs: Date.now() - startedAt },
            correlationId,
          );
        }
      }
    },
    async close() {
      await options.store.close?.();
    },
  };
}

function validateTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)
    throw new Error(
      "Cache TTL must be a positive whole number of milliseconds.",
    );
}

function validatePriority(priority: number): void {
  if (!Number.isSafeInteger(priority))
    throw new Error("Cache priority must be a safe whole number.");
}

function scopeAttributes(key: string): { namespace: string } {
  const namespace = key.split(":", 1)[0] ?? "default";
  return { namespace: namespace.slice(0, 64) || "default" };
}
