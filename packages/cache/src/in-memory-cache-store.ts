import type {
  CacheStore,
  CacheStoreWriteOptions,
  CacheStoreWriteResult,
} from "@edu-service/core";

interface Entry {
  value: string;
  expiresAt: number;
  priority: number;
  accesses: number;
  lastAccessedAt: number;
}

/** A bounded process-local cache for development, tests, and one-process deployments. */
export class InMemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: { maxEntries?: number; now?: () => number } = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries <= 0)
      throw new Error("maxEntries must be a positive whole number.");
    this.now = options.now ?? Date.now;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    entry.accesses += 1;
    entry.lastAccessedAt = this.now();
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    options: CacheStoreWriteOptions,
  ): Promise<CacheStoreWriteResult> {
    const now = this.now();
    this.removeExpired(now);
    this.entries.set(key, {
      value,
      expiresAt: now + options.ttlMs,
      priority: options.priority,
      accesses: 0,
      lastAccessedAt: now,
    });
    let evicted = 0;
    while (this.entries.size > this.maxEntries) {
      const victim = this.findEvictionCandidate();
      this.entries.delete(victim);
      evicted += 1;
    }
    return { evicted };
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        count += 1;
      }
    }
    return count;
  }

  private removeExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  /** Evict lower priority, then less-used, then least-recently-used entries. */
  private findEvictionCandidate(): string {
    let candidate: [string, Entry] | undefined;
    for (const entry of this.entries) {
      if (!candidate || this.isLowerPriority(entry[1], candidate[1]))
        candidate = entry;
    }
    return candidate![0];
  }

  private isLowerPriority(left: Entry, right: Entry): boolean {
    return (
      left.priority < right.priority ||
      (left.priority === right.priority && left.accesses < right.accesses) ||
      (left.priority === right.priority &&
        left.accesses === right.accesses &&
        left.lastAccessedAt < right.lastAccessedAt)
    );
  }
}
