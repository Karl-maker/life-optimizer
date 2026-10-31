export interface TrieOptions {
  /** BCP-47 locale used only for locale-aware case folding. No dictionary is bundled. */
  language: string;
  caseSensitive?: boolean;
  /** Strip Unicode combining marks only when explicitly enabled. */
  normalizeDiacritics?: boolean;
  unicodeNormalization?: "NFC" | "NFKC";
  /** Overrides built-in normalization. Custom strategies cannot be snapshotted. */
  normalize?: (word: string) => string;
  /** Prevents insert, delete, and clear. Prefer for loaded production snapshots. */
  readOnly?: boolean;
}

export interface TrieEntry<T> {
  readonly key: string;
  readonly value: T;
}
export interface TrieStats {
  readonly entryCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly readOnly: boolean;
}
export interface TrieValueCodec<T> {
  encode(value: T): Uint8Array;
  decode(bytes: Uint8Array): T;
}
export interface TrieSnapshotMetadata {
  readonly formatVersion: 1;
  readonly language: string;
  readonly caseSensitive: boolean;
  readonly normalizeDiacritics: boolean;
  readonly unicodeNormalization: "NFC" | "NFKC";
  readonly entryCount: number;
  readonly createdAt: string;
}

interface TrieNode<T> {
  children: Map<string, TrieNode<T>>;
  entry?: TrieEntry<T>;
}
interface SnapshotEnvelope {
  metadata: TrieSnapshotMetadata;
  payloadOffset: number;
  payloadLength: number;
}
const MAGIC = new Uint8Array([0x45, 0x44, 0x54, 0x52]); // EDTR
const VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** A Unicode code-point trie. Values live only at terminal nodes. */
export class Trie<T> {
  private root: TrieNode<T> = createNode<T>();
  private entryCount = 0;
  private readonly options: Required<
    Omit<TrieOptions, "normalize" | "readOnly">
  > &
    Pick<TrieOptions, "normalize">;
  private readonly readOnly: boolean;

  public constructor(options: TrieOptions) {
    if (!options.language.trim())
      throw new TypeError("language must not be empty");
    this.options = {
      language: options.language,
      caseSensitive: options.caseSensitive ?? false,
      normalizeDiacritics: options.normalizeDiacritics ?? false,
      unicodeNormalization: options.unicodeNormalization ?? "NFC",
      ...(options.normalize ? { normalize: options.normalize } : {}),
    };
    this.readOnly = options.readOnly ?? false;
  }

  public insert(key: string, value: T): this {
    this.assertMutable();
    const normalized = this.normalize(key);
    let node = this.root;
    for (const character of normalized) {
      let next = node.children.get(character);
      if (!next) {
        next = createNode<T>();
        node.children.set(character, next);
      }
      node = next;
    }
    if (!node.entry) this.entryCount++;
    node.entry = { key, value };
    return this;
  }

  public addMany(entries: Iterable<TrieEntry<T>>): this {
    this.assertMutable();
    for (const entry of entries) this.insert(entry.key, entry.value);
    return this;
  }

  /** Uses `found` so a stored `undefined` remains distinguishable from absence. */
  public search(
    key: string,
  ):
    | { readonly found: true; readonly value: T; readonly key: string }
    | { readonly found: false } {
    const entry = this.nodeFor(this.normalize(key))?.entry;
    return entry
      ? { found: true, key: entry.key, value: entry.value }
      : { found: false };
  }

  public startsWith(prefix: string): boolean {
    return this.nodeFor(this.normalize(prefix)) !== undefined;
  }

  /** Returns insertion-independent, code-point lexical order by normalized key. */
  public find(prefix: string, limit = 20): readonly TrieEntry<T>[] {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new RangeError("limit must be a non-negative safe integer");
    if (limit === 0) return [];
    const start = this.nodeFor(this.normalize(prefix));
    if (!start) return [];
    const result: TrieEntry<T>[] = [];
    const visit = (node: TrieNode<T>): void => {
      if (result.length >= limit) return;
      if (node.entry) result.push(node.entry);
      for (const child of [...node.children.keys()].sort()) {
        visit(node.children.get(child)!);
        if (result.length >= limit) return;
      }
    };
    visit(start);
    return result;
  }

  public delete(key: string): boolean {
    this.assertMutable();
    const characters = [...this.normalize(key)];
    const path: Array<readonly [TrieNode<T>, string]> = [];
    let node = this.root;
    for (const character of characters) {
      const next = node.children.get(character);
      if (!next) return false;
      path.push([node, character]);
      node = next;
    }
    if (!node.entry) return false;
    delete node.entry;
    this.entryCount--;
    for (
      let index = path.length - 1;
      index >= 0 && !node.entry && node.children.size === 0;
      index--
    ) {
      const [parent, character] = path[index]!;
      parent.children.delete(character);
      node = parent;
    }
    return true;
  }

  public clear(): void {
    this.assertMutable();
    this.root = createNode<T>();
    this.entryCount = 0;
  }

  public getStats(): TrieStats {
    let nodeCount = 0;
    let edgeCount = 0;
    const count = (node: TrieNode<T>): void => {
      nodeCount++;
      edgeCount += node.children.size;
      for (const child of node.children.values()) count(child);
    };
    count(this.root);
    return {
      entryCount: this.entryCount,
      nodeCount,
      edgeCount,
      readOnly: this.readOnly,
    };
  }

  /**
   * Produces a versioned binary snapshot. Supply a codec because generic values
   * have no portable default representation; custom normalizers are deliberately rejected.
   */
  public serialize(codec: TrieValueCodec<T>): Uint8Array {
    if (this.options.normalize)
      throw new Error("A trie with a custom normalizer cannot be serialized");
    const metadata: TrieSnapshotMetadata = {
      formatVersion: 1,
      language: this.options.language,
      caseSensitive: this.options.caseSensitive,
      normalizeDiacritics: this.options.normalizeDiacritics,
      unicodeNormalization: this.options.unicodeNormalization,
      entryCount: this.entryCount,
      createdAt: new Date().toISOString(),
    };
    const payload = encodeEntries(
      this.find("", Number.MAX_SAFE_INTEGER),
      codec,
    );
    const metadataBytes = encoder.encode(JSON.stringify(metadata));
    const bytes = new Uint8Array(
      MAGIC.length + 1 + 4 + 4 + 4 + metadataBytes.length + payload.length,
    );
    bytes.set(MAGIC);
    bytes[4] = VERSION;
    writeUint32(bytes, 5, metadataBytes.length);
    writeUint32(bytes, 9, payload.length);
    writeUint32(bytes, 13, checksum(metadataBytes, payload));
    bytes.set(metadataBytes, 17);
    bytes.set(payload, 17 + metadataBytes.length);
    return bytes;
  }

  /** Validates magic, version, metadata, lengths, checksum, and all entry bytes before returning a read-only trie. */
  public static deserialize<T>(
    snapshot: Uint8Array,
    codec: TrieValueCodec<T>,
  ): Trie<T> {
    const envelope = parseSnapshot(snapshot);
    const { metadata } = envelope;
    const trie = new Trie<T>({
      language: metadata.language,
      caseSensitive: metadata.caseSensitive,
      normalizeDiacritics: metadata.normalizeDiacritics,
      unicodeNormalization: metadata.unicodeNormalization,
    });
    let offset = envelope.payloadOffset;
    let entries = 0;
    while (offset < envelope.payloadOffset + envelope.payloadLength) {
      const keyLength = readUint32(snapshot, offset);
      offset += 4;
      const keyEnd = offset + keyLength;
      if (keyEnd > snapshot.length)
        throw new Error("Snapshot entry key exceeds payload");
      const key = decoder.decode(snapshot.subarray(offset, keyEnd));
      offset = keyEnd;
      const valueLength = readUint32(snapshot, offset);
      offset += 4;
      const valueEnd = offset + valueLength;
      if (valueEnd > snapshot.length)
        throw new Error("Snapshot entry value exceeds payload");
      trie.insert(key, codec.decode(snapshot.subarray(offset, valueEnd)));
      offset = valueEnd;
      entries++;
    }
    if (
      entries !== metadata.entryCount ||
      trie.entryCount !== metadata.entryCount
    )
      throw new Error("Snapshot entry count does not match metadata");
    return new Trie<T>({
      language: metadata.language,
      caseSensitive: metadata.caseSensitive,
      normalizeDiacritics: metadata.normalizeDiacritics,
      unicodeNormalization: metadata.unicodeNormalization,
      readOnly: true,
    }).addSnapshotEntries(trie.find("", Number.MAX_SAFE_INTEGER));
  }

  public static inspectSnapshot(snapshot: Uint8Array): TrieSnapshotMetadata {
    return parseSnapshot(snapshot).metadata;
  }

  private addSnapshotEntries(entries: readonly TrieEntry<T>[]): this {
    // Construction is the only controlled write before an immutable instance escapes.
    const target = this.readOnly
      ? new Trie<T>({ ...this.options, readOnly: false })
      : this;
    target.addMany(entries);
    if (!this.readOnly) return this;
    this.root = target.root;
    this.entryCount = target.entryCount;
    return this;
  }

  private normalize(key: string): string {
    if (typeof key !== "string")
      throw new TypeError("Trie keys must be strings");
    if (this.options.normalize) return this.options.normalize(key);
    let normalized = key.normalize(this.options.unicodeNormalization);
    if (!this.options.caseSensitive)
      normalized = normalized.toLocaleLowerCase(this.options.language);
    if (this.options.normalizeDiacritics)
      normalized = normalized
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .normalize("NFC");
    return normalized;
  }

  private nodeFor(key: string): TrieNode<T> | undefined {
    let node: TrieNode<T> | undefined = this.root;
    for (const character of key) node = node?.children.get(character);
    return node;
  }
  private assertMutable(): void {
    if (this.readOnly) throw new Error("Trie is read-only");
  }
}

/** Codec for JSON-compatible values. It intentionally rejects undefined. */
export function jsonValueCodec<T>(): TrieValueCodec<T> {
  return {
    encode: (value) => {
      const encoded = JSON.stringify(value);
      if (encoded === undefined)
        throw new TypeError("undefined is not JSON-serializable");
      return encoder.encode(encoded);
    },
    decode: (bytes) => JSON.parse(decoder.decode(bytes)) as T,
  };
}
/** Codec for a set-like `Trie<undefined>`; it writes no value bytes. */
export const undefinedValueCodec: TrieValueCodec<undefined> = {
  encode: () => new Uint8Array(),
  decode: () => undefined,
};

function createNode<T>(): TrieNode<T> {
  return { children: new Map() };
}
function encodeEntries<T>(
  entries: readonly TrieEntry<T>[],
  codec: TrieValueCodec<T>,
): Uint8Array {
  const records = entries.map((entry) => ({
    key: encoder.encode(entry.key),
    value: codec.encode(entry.value),
  }));
  const length = records.reduce(
    (total, record) => total + 8 + record.key.length + record.value.length,
    0,
  );
  const result = new Uint8Array(length);
  let offset = 0;
  for (const record of records) {
    writeUint32(result, offset, record.key.length);
    offset += 4;
    result.set(record.key, offset);
    offset += record.key.length;
    writeUint32(result, offset, record.value.length);
    offset += 4;
    result.set(record.value, offset);
    offset += record.value.length;
  }
  return result;
}
function parseSnapshot(snapshot: Uint8Array): SnapshotEnvelope {
  if (
    snapshot.length < 17 ||
    !MAGIC.every((byte, index) => snapshot[index] === byte)
  )
    throw new Error("Invalid trie snapshot magic");
  if (snapshot[4] !== VERSION)
    throw new Error("Unsupported trie snapshot version");
  const metadataLength = readUint32(snapshot, 5);
  const payloadLength = readUint32(snapshot, 9);
  const expectedChecksum = readUint32(snapshot, 13);
  const payloadOffset = 17 + metadataLength;
  if (payloadOffset + payloadLength !== snapshot.length)
    throw new Error("Invalid trie snapshot lengths");
  const payload = snapshot.subarray(payloadOffset);
  if (
    checksum(snapshot.subarray(17, payloadOffset), payload) !== expectedChecksum
  )
    throw new Error("Trie snapshot checksum mismatch");
  let metadata: unknown;
  try {
    metadata = JSON.parse(decoder.decode(snapshot.subarray(17, payloadOffset)));
  } catch {
    throw new Error("Invalid trie snapshot metadata");
  }
  if (!isMetadata(metadata)) throw new Error("Invalid trie snapshot metadata");
  return { metadata, payloadOffset, payloadLength };
}
function isMetadata(value: unknown): value is TrieSnapshotMetadata {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.formatVersion === 1 &&
    typeof item.language === "string" &&
    typeof item.caseSensitive === "boolean" &&
    typeof item.normalizeDiacritics === "boolean" &&
    (item.unicodeNormalization === "NFC" ||
      item.unicodeNormalization === "NFKC") &&
    Number.isSafeInteger(item.entryCount) &&
    (item.entryCount as number) >= 0 &&
    typeof item.createdAt === "string"
  );
}
function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    offset,
    value,
  );
}
function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw new Error("Truncated trie snapshot");
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset);
}
function checksum(...parts: readonly Uint8Array[]): number {
  let hash = 0x811c9dc5;
  for (const bytes of parts)
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  return hash >>> 0;
}
