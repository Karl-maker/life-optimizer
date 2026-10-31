/** Encodes a value consistently for hashing. Do not use a process-random serializer. */
export type BloomValueSerializer<T> = (value: T) => string | Uint8Array;

export interface BloomFilterOptions<T> {
  /** Expected inserts; exceeding this raises the real false-positive rate. */
  expectedInsertions: number;
  /** Desired probability for an absent item to return `true`, in (0, 1). */
  falsePositiveRate?: number;
  serialize: BloomValueSerializer<T>;
}

export interface BloomFilterStats {
  readonly bitCount: number;
  readonly hashCount: number;
  readonly insertions: number;
  readonly estimatedFalsePositiveRate: number;
  readonly memoryBytes: number;
}

/**
 * A mutable, in-memory approximate membership filter. `mightContain` returning
 * false is definitive; true must be checked against an authoritative source.
 */
export class BloomFilter<T> {
  private readonly bits: Uint8Array;
  private readonly bitCount: number;
  private readonly hashCount: number;
  private readonly serializeValue: BloomValueSerializer<T>;
  private insertions = 0;

  public constructor(options: BloomFilterOptions<T>) {
    if (
      !Number.isSafeInteger(options.expectedInsertions) ||
      options.expectedInsertions < 1
    )
      throw new RangeError(
        "expectedInsertions must be a positive safe integer",
      );
    const rate = options.falsePositiveRate ?? 0.01;
    if (!(rate > 0 && rate < 1))
      throw new RangeError(
        "falsePositiveRate must be greater than 0 and less than 1",
      );

    const optimalBits = Math.ceil(
      (-options.expectedInsertions * Math.log(rate)) / Math.LN2 ** 2,
    );
    this.bitCount = Math.max(8, Math.ceil(optimalBits / 8) * 8);
    this.hashCount = Math.max(
      1,
      Math.round((this.bitCount / options.expectedInsertions) * Math.LN2),
    );
    this.bits = new Uint8Array(this.bitCount / 8);
    this.serializeValue = options.serialize;
  }

  public add(value: T): this {
    const [first, second] = hashPair(toBytes(this.serializeValue(value)));
    for (let index = 0; index < this.hashCount; index++)
      this.setBit(position(first, second, index, this.bitCount));
    this.insertions++;
    return this;
  }

  public addMany(values: Iterable<T>): this {
    for (const value of values) this.add(value);
    return this;
  }

  public mightContain(value: T): boolean {
    const [first, second] = hashPair(toBytes(this.serializeValue(value)));
    for (let index = 0; index < this.hashCount; index++)
      if (!this.hasBit(position(first, second, index, this.bitCount)))
        return false;
    return true;
  }

  public clear(): void {
    this.bits.fill(0);
    this.insertions = 0;
  }

  public getStats(): BloomFilterStats {
    const fractionSet =
      1 - Math.exp((-this.hashCount * this.insertions) / this.bitCount);
    return {
      bitCount: this.bitCount,
      hashCount: this.hashCount,
      insertions: this.insertions,
      estimatedFalsePositiveRate: fractionSet ** this.hashCount,
      memoryBytes: this.bits.byteLength,
    };
  }

  private setBit(index: number): void {
    const byte = Math.floor(index / 8);
    this.bits[byte]! |= 1 << (index % 8);
  }

  private hasBit(index: number): boolean {
    const byte = Math.floor(index / 8);
    return (this.bits[byte]! & (1 << (index % 8))) !== 0;
  }
}

const encoder = new TextEncoder();
function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? encoder.encode(value) : value;
}
function hashPair(bytes: Uint8Array): readonly [number, number] {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193);
    second = Math.imul(second ^ byte, 0x85ebca6b);
  }
  return [first >>> 0, second >>> 0 || 0x9e3779b9];
}
function position(
  first: number,
  second: number,
  index: number,
  bitCount: number,
): number {
  return ((first + Math.imul(index, second >>> 0)) >>> 0) % bitCount;
}
