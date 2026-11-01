import { createHmac } from "node:crypto";

export interface RedisBloomCommands {
  sendCommand(command: readonly string[]): Promise<unknown>;
}

export interface PresenceIndex {
  /** False is authoritative absence; true means "possibly present". */
  mightContain(kind: "email" | "phone", value: string): Promise<boolean>;
  add(kind: "email" | "phone", value: string): Promise<void>;
}

/**
 * Shared RedisBloom index. Identifiers are normalized and HMACed before Redis so
 * filter dumps, command telemetry, and key inspection do not disclose PII.
 */
export class RedisIdentityBloomFilter implements PresenceIndex {
  readonly #ready = new Map<string, Promise<void>>();

  constructor(
    private readonly redis: RedisBloomCommands,
    private readonly options: {
      keyPrefix: string;
      hmacKey: string;
      capacity: number;
      errorRate?: number;
    },
  ) {
    if (!options.keyPrefix || options.keyPrefix.length > 128)
      throw new Error("Bloom key prefix must be present and bounded.");
    if (Buffer.byteLength(options.hmacKey) < 32)
      throw new Error("Bloom HMAC key must contain at least 32 bytes.");
    if (!Number.isSafeInteger(options.capacity) || options.capacity < 1)
      throw new Error("Bloom capacity must be a positive safe integer.");
    if (
      options.errorRate !== undefined &&
      (!Number.isFinite(options.errorRate) ||
        options.errorRate <= 0 ||
        options.errorRate >= 1)
    )
      throw new Error("Bloom error rate must be between zero and one.");
  }

  async mightContain(kind: "email" | "phone", value: string): Promise<boolean> {
    await this.ensure(kind);
    const ready = await this.redis.sendCommand(["GET", this.readyKey(kind)]);
    if (String(ready ?? "") !== "ready") return true;
    const result = await this.redis.sendCommand([
      "BF.EXISTS",
      this.key(kind),
      this.digest(kind, value),
    ]);
    return result === 1 || result === true;
  }

  async add(kind: "email" | "phone", value: string): Promise<void> {
    await this.ensure(kind);
    await this.redis.sendCommand([
      "BF.ADD",
      this.key(kind),
      this.digest(kind, value),
    ]);
  }

  /** Call only after a complete source-of-truth backfill for this identifier kind. */
  async markReady(kind: "email" | "phone"): Promise<void> {
    await this.ensure(kind);
    await this.redis.sendCommand(["SET", this.readyKey(kind), "ready"]);
  }

  private ensure(kind: "email" | "phone"): Promise<void> {
    const key = this.key(kind);
    let ready = this.#ready.get(key);
    if (!ready) {
      ready = this.reserve(key);
      this.#ready.set(key, ready);
    }
    return ready;
  }

  private async reserve(key: string): Promise<void> {
    try {
      await this.redis.sendCommand([
        "BF.RESERVE",
        key,
        String(this.options.errorRate ?? 0.001),
        String(this.options.capacity),
        "EXPANSION",
        "2",
      ]);
      // A newly reserved filter is empty and must not produce authoritative negatives.
      await this.redis.sendCommand(["DEL", `${key}:ready`]);
    } catch (error) {
      if (
        !/item exists|key exists/i.test(
          error instanceof Error ? error.message : "",
        )
      )
        throw error;
    }
  }

  private key(kind: "email" | "phone"): string {
    return `${this.options.keyPrefix}:${kind}:v1`;
  }

  private readyKey(kind: "email" | "phone"): string {
    return `${this.key(kind)}:ready`;
  }

  private digest(kind: "email" | "phone", value: string): string {
    const normalized =
      kind === "email"
        ? value.trim().toLowerCase()
        : value.replace(/[\s().-]/g, "");
    return createHmac("sha256", this.options.hmacKey)
      .update(`${kind}\0${normalized}`)
      .digest("base64url");
  }
}
