import type {
  CacheStore,
  CacheStoreWriteOptions,
  CacheStoreWriteResult,
} from "@edu-service/core";

/** Minimal node-redis surface so adapter behavior stays unit-testable without Redis. */
export interface RedisCommands {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { PX: number }): Promise<unknown>;
  del(keys: string | readonly string[]): Promise<number>;
  scanIterator(options: {
    MATCH: string;
    COUNT: number;
  }): AsyncIterable<string>;
  close(): Promise<void>;
}

/** Redis adapter with millisecond TTLs and cursor-based namespace invalidation. */
export class RedisCacheStore implements CacheStore {
  constructor(
    private readonly client: RedisCommands,
    private readonly scanCount = 100,
  ) {}

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }
  async set(
    key: string,
    value: string,
    options: CacheStoreWriteOptions,
  ): Promise<CacheStoreWriteResult> {
    await this.client.set(key, value, { PX: options.ttlMs });
    // Redis eviction happens server-side; SET does not report evicted key counts.
    return { evicted: 0 };
  }
  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
  async deleteByPrefix(prefix: string): Promise<number> {
    let count = 0;
    let batch: string[] = [];
    for await (const key of this.client.scanIterator({
      MATCH: `${escapeGlob(prefix)}*`,
      COUNT: this.scanCount,
    })) {
      batch.push(key);
      if (batch.length === this.scanCount) {
        count += await this.client.del(batch);
        batch = [];
      }
    }
    if (batch.length > 0) count += await this.client.del(batch);
    return count;
  }
  close(): Promise<void> {
    return this.client.close();
  }
}

function escapeGlob(value: string): string {
  return value.replace(/[\\*?\[\]]/g, (character) => `\\${character}`);
}
