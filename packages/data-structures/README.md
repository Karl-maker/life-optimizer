# `@edu-service/data-structures`

Dependency-free, provider-neutral structures shared by Edu Service packages. It contains no learning rules, vocabulary, S3/Redis client, database code, ranking, autocomplete endpoint, or cross-worker coordination.

## Choose the right structure

Use `Trie<T>` when a caller needs exact key/value lookup _and_ prefix enumeration—such as a client autocomplete service, an in-memory vocabulary, or a command palette. The trie returns candidates; the caller owns authorization, ranking, typo correction, relevance, and presentation.

Use `BloomFilter<T>` only as a cheap negative cache before an expensive authoritative lookup. `mightContain(key) === false` means the key is definitely absent; `true` means **maybe**, so it must not grant access, reject a request, or replace a database/trie lookup. Bloom filters do not enumerate, return values, or support deletion.

```text
client prefix -> application ranking/permissions -> Trie.find(prefix) -> candidates
request key   -> Bloom.mightContain(key) -> false: skip lookup; true: authoritative lookup
```

## Trie: client-facing usage

```ts
import { Trie } from "@edu-service/data-structures";

type Suggestion = { readonly lessonId: string; readonly label: string };

const vocabulary = new Trie<Suggestion>({
  language: "fr",
  caseSensitive: false,
  normalizeDiacritics: true, // explicit: école and ecole share one index key
});

vocabulary.addMany([
  { key: "École", value: { lessonId: "l_1", label: "École" } },
  { key: "Économie", value: { lessonId: "l_2", label: "Économie" } },
]);

const candidates = vocabulary.find("eco", 10);
// The returned keys preserve their inserted spelling: École, Économie.
```

`search` returns `{ found: false }` or `{ found: true, key, value }`, so a stored `undefined` is not confused with a missing entry. `insert` overwrites an existing _normalized_ key, while preserving the most recently inserted original spelling. `startsWith`, `delete`, `clear`, `addMany`, and `getStats` round out the mutable API. `find` returns code-point lexical order, not locale collation or popularity order.

Use `addMany` for imports; it avoids caller-side loop boilerplate but deliberately keeps the same semantics as `insert`. Exact lookup, insertion, and deletion are O(k) for normalized key length. Prefix lookup is O(p + r) plus sorting the visited child labels (where `p` is prefix length and `r` is visited result-tree work). Memory is O(total distinct normalized code points plus stored values).

### Language and Unicode behavior

The trie walks JavaScript Unicode code points (`for…of`), rather than UTF-16 code units. It applies NFC by default (or NFKC when selected), optional locale-aware `toLocaleLowerCase(language)`, then optional combining-mark removal. Accent folding is never automatic. A `normalize` function can define a product-specific strategy, but a trie using one cannot be serialized because a function has no portable representation.

This is not grapheme segmentation, locale collation, transliteration, stemming, or a dictionary. Emoji sequences may comprise multiple code points; a prefix can therefore end within a visible grapheme. Keep language instances separate when their folding rules differ, and do not use NFKC unless compatibility folding is wanted.

## Snapshots and immutable serving

Generic values need an explicit portable codec. `jsonValueCodec` handles JSON values (not `undefined`); `undefinedValueCodec` is available for a set-like trie. A snapshot has `EDTR` magic, format version, UTF-8 metadata, payload length, and an FNV-1a checksum. `deserialize` validates all of those and returns a read-only trie.

```ts
import { Trie, jsonValueCodec } from "@edu-service/data-structures";

const snapshot = vocabulary.serialize(jsonValueCodec<Suggestion>());
const servingTrie = Trie.deserialize(snapshot, jsonValueCodec<Suggestion>());
// servingTrie.insert(...) throws: it is intentionally immutable.
```

The checksum detects accidental corruption; it is not authentication. Verify the snapshot through your transport/storage security boundary when tamper resistance matters.

### Deployment patterns (examples, not package functionality)

1. A build job creates one trie per language, serializes it, validates with `Trie.inspectSnapshot`, and writes immutable versioned objects such as `s3://application-data/trie/fr/snapshots/v2/index.bin`.
2. The job updates a small manifest only after the object upload succeeds. Retain the prior version for rollback.
3. An application downloads the manifest/snapshot at startup, deserializes to local memory, and serves every lookup locally. S3 is never on the lookup path.
4. Redis/ElastiCache may cache the snapshot bytes or manifest/version and broadcast a refresh hint. It is optional and never the source of truth; failure leaves the last valid in-memory trie active.
5. On a periodic refresh, build a new immutable trie, validate it, then atomically swap the application-held reference. If any step fails, retain the old reference.

For frequent changes, a consuming package can maintain a small mutable overlay and periodically rebuild the base snapshot. This package does not implement storage, scheduling, worker synchronization, or the overlay.

### Sharing across application instances safely

An in-memory trie is **not shared** between Node processes, containers, browser tabs, or machines. Do not try to share a mutable `Trie` through Redis, a network filesystem, a worker message channel, or a distributed lock. Instead, share a completed snapshot and let each instance hold its own read-only `Trie`.

```text
single builder / publisher                     serving instances
--------------------------                     -----------------
build mutable trie                             read manifest version
       |                                       download immutable snapshot
validate + serialize                           validate + deserialize locally
       |                                       atomically replace local reference
write new immutable snapshot ----------------> continue serving old reference on failure
       |
compare-and-swap manifest to new version
```

Use this protocol in a separate composition/infrastructure package:

1. Elect **one publisher** for a language/version. A CI job, queue consumer partition, or database advisory lock is usually simpler than a distributed lease. Build the mutable trie entirely in that publisher; readers never mutate a serving snapshot.
2. Write a new, content-addressed or versioned object first, for example `en/snapshots/2026-10-31T16-30-00Z/index.bin`. Never overwrite an object that readers may be downloading.
3. Read it back (or inspect the generated bytes), call `Trie.inspectSnapshot`, and verify the expected language, format, entry count, and checksum before publication.
4. Advance the small language manifest with a **compare-and-swap** precondition (S3 `If-Match` ETag/version, a database row-version update, or Redis `WATCH`/`MULTI`). If another publisher advanced it first, discard/retry from current state; do not silently win by last write.
5. Readers poll or receive a version notification, fetch the new immutable object, fully validate/deserialize it, then replace one application-level reference. In JavaScript, assigning the reference is atomic: requests that already captured the prior reference finish on it; later requests use the replacement.
6. Retain the old snapshot and manifest history. On download, validation, or decode failure, log safe operational metadata and keep serving the old local trie. Do not publish a partially built trie.

Do not use a Redis lock as correctness infrastructure unless its expiry, fencing token, retries, and split-brain behavior are explicitly designed and tested. If a lease is unavoidable, use a monotonic fencing token in the manifest write and reject writes from older tokens. The snapshot bytes themselves remain the durable source; Redis can only coordinate refresh notifications or cache immutable bytes. Rate-limit polling, cap snapshot size before decoding, enforce a download timeout, and reject wrong language/unsupported format before swapping.

Here is the application shape; storage operations intentionally belong to a caller-owned adapter:

```ts
import { Trie, jsonValueCodec } from "@edu-service/data-structures";

type Suggestion = { readonly lessonId: string; readonly label: string };
let activeTrie: Trie<Suggestion> = await loadInitialTrie();

async function refreshIfNeeded(manifest: {
  readonly version: string;
  readonly url: string;
}) {
  const response = await fetch(manifest.url, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return; // Keep the already validated local trie.
  const bytes = new Uint8Array(await response.arrayBuffer());
  const metadata = Trie.inspectSnapshot(bytes);
  if (metadata.language !== "fr") return;
  const replacement = Trie.deserialize(bytes, jsonValueCodec<Suggestion>());
  activeTrie = replacement;
}
```

`activeTrie` should be captured once at the beginning of a request before calling `find` or `search`; a request should not mix two versions. This is safe for concurrent JavaScript reads because serving tries are immutable. Other runtimes need the equivalent atomic-reference or read-copy-update primitive.

### Browser/client snapshot cache backed by S3

Client-side loading is appropriate only for data that the client is authorized to possess—never private vocabulary, entitlement data, hidden moderation terms, or data whose presence itself is sensitive. A trie/Bloom filter is a cache and cannot enforce authorization. Prefer a CDN in front of an immutable S3 object; alternatively issue a short-lived presigned URL from an authenticated API. Do not place long-lived S3 credentials in a browser bundle.

Publish a manifest such as `{ "version": "v42", "url": "https://cdn.example.com/trie/fr/v42.bin" }` with restrictive CORS for the exact web origin. The application can cache the immutable bytes in Cache Storage or IndexedDB under the manifest version, validate them on every load, and only then deserialize. The package's checksum catches accidental corruption; use a signed manifest or trusted HTTPS/CDN origin when authenticity is required.

```ts
import { Trie, jsonValueCodec } from "@edu-service/data-structures";

type Suggestion = { readonly lessonId: string; readonly label: string };

export async function loadClientTrie(
  manifestUrl: string,
): Promise<Trie<Suggestion>> {
  const manifestResponse = await fetch(manifestUrl, { cache: "no-cache" });
  if (!manifestResponse.ok) throw new Error("Could not load trie manifest");
  const manifest = (await manifestResponse.json()) as {
    version: string;
    url: string;
  };
  const cache = await caches.open("trie-snapshots-v1");
  const cacheKey = new Request(
    new URL(`/__trie_cache__/${manifest.version}`, window.location.origin),
  );
  let response = await cache.match(cacheKey);
  if (!response) {
    const networkResponse = await fetch(manifest.url, { cache: "no-store" });
    if (!networkResponse.ok) throw new Error("Could not load trie snapshot");
    await cache.put(cacheKey, networkResponse.clone());
    response = networkResponse;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const metadata = Trie.inspectSnapshot(bytes);
  if (metadata.language !== "fr") throw new Error("Unexpected trie language");
  return Trie.deserialize(bytes, jsonValueCodec<Suggestion>());
}
```

On an offline load, fall back only to a previously validated cached version; on a failed newer download, leave that old version in place. Evict older named cache entries after a successful swap, not before. For large snapshots, use IndexedDB instead of Cache Storage if browser quota/eviction behavior requires more control; always place an application-defined maximum byte limit before calling `arrayBuffer()`.

## Bloom filter: when and how

```ts
import { BloomFilter } from "@edu-service/data-structures";

const knownLessonIds = new BloomFilter<string>({
  expectedInsertions: 100_000,
  falsePositiveRate: 0.01,
  serialize: (id) => id,
});
knownLessonIds.addMany(ids);

if (!knownLessonIds.mightContain(lessonId)) {
  return undefined; // definitely absent: skip an expensive repository read
}
return lessons.findById(lessonId); // a positive still needs confirmation
```

Give it a stable serializer and realistic expected capacity. Adding more than planned raises the actual false-positive rate. The filter uses a compact bit array and double hashing; insertion and membership are O(k), where `k` is the calculated hash count. It is mutable in one JavaScript isolate but is not shared-memory/thread safe. Rebuild it when the backing set changes substantially.

## Architecture and scaling decision

```text
Application/core package
        |
        v
@edu-service/data-structures  -- serialization + language configuration
        ^
        |
separate filesystem/S3/Redis adapters
```

The initial implementation is a `Map`-backed code-point trie. It supports mutation, deletion, Unicode normalization, and predictable client use without pre-sorting input. A compressed radix trie reduces node count but makes mutation and stored-key preservation more complex; a minimal FST can be smaller still for a static, sorted dictionary. Apache Lucene’s FST shows the value of versioned compact static data, but that machinery is disproportionate here. Measure `getStats`, snapshot size, and real query latency before introducing a frozen FST/radix representation behind the same public API.

The test suite exercises 10,000 bulk entries, Unicode and language options, deletion, snapshot corruption/compatibility, immutable snapshots, and Bloom behavior. It intentionally makes no machine-dependent latency promise; benchmark representative vocabulary, value codec, memory limit, and deployment runtime before setting a production SLO.

## Research influences

The static-snapshot direction is informed by [Apache Lucene’s versioned compact FST](https://github.com/apache/lucene/blob/main/lucene/core/src/java/org/apache/lucene/util/fst/FST.java). The Bloom API follows the essential contract illustrated by [FastFilter](https://github.com/Genbox/FastFilter): negatives are definitive, positives are only probable, and mutable filters must be sized for expected capacity. The local implementation is dependency-free and does not copy either project’s code.

For an S3 adapter, use [conditional object writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-requests.html) for the manifest rather than last-writer-wins updates. AWS documents that a presigned URL is bearer access with a limited lifetime; treat it accordingly and never expose AWS credentials in the browser.
