/**
 * A volatile value store owned by an infrastructure adapter. Cache entries are
 * never a source of truth: callers must be able to reload a missed entry.
 */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options: CacheStoreWriteOptions,
  ): Promise<CacheStoreWriteResult>;
  delete(key: string): Promise<void>;
  /** Removes entries in a namespace. Implementations must not use blocking key enumeration. */
  deleteByPrefix(prefix: string): Promise<number>;
  close?(): Promise<void>;
}

/**
 * Adapter-neutral cache-entry controls. Higher priorities are retained before
 * lower ones when a bounded local cache must evict an entry.
 */
export interface CacheStoreWriteOptions {
  ttlMs: number;
  priority: number;
}

/** Best-effort eviction metadata. Distributed stores may not be able to report it. */
export interface CacheStoreWriteResult {
  evicted: number;
}
