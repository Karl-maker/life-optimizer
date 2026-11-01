import type { Cache } from "@edu-service/cache";
import type { ObjectStore } from "@edu-service/storage";
import { mergeCmsDocuments, normalizeCmsIdentity } from "./crdt.js";
import type { CmsCrdtDocument, CmsIdentity, CmsPublication } from "./model.js";
import type {
  CmsDraftStore,
  CmsPublicationReader,
  CmsPublisher,
} from "./ports.js";
import { cmsStorageKey } from "./ports.js";

function key(identity: CmsIdentity): string {
  const normalized = normalizeCmsIdentity(identity);
  return `${normalized.kind}:${normalized.key}:${normalized.locale}`;
}

export class InMemoryCmsDraftStore implements CmsDraftStore {
  readonly #drafts = new Map<string, CmsCrdtDocument>();

  async get(identity: CmsIdentity): Promise<CmsCrdtDocument | null> {
    return this.#drafts.get(key(identity)) ?? null;
  }

  async save(document: CmsCrdtDocument): Promise<void> {
    const existing = this.#drafts.get(key(document.identity));
    this.#drafts.set(
      key(document.identity),
      existing ? mergeCmsDocuments(existing, document) : document,
    );
  }
}

export class InMemoryCmsPublicationStore
  implements CmsPublicationReader, CmsPublisher
{
  readonly #publications = new Map<string, Map<string, CmsPublication>>();

  async list(identity: CmsIdentity): Promise<readonly CmsPublication[]> {
    return [...(this.#publications.get(key(identity))?.values() ?? [])];
  }

  async put(publication: CmsPublication) {
    const identityKey = key(publication.identity);
    const releases = this.#publications.get(identityKey) ?? new Map();
    releases.set(publication.releaseId, publication);
    this.#publications.set(identityKey, releases);
    return {
      key: cmsStorageKey(publication.identity, publication.releaseId),
      path: `memory://${identityKey}/${publication.releaseId}`,
      url: `memory://${identityKey}/${publication.releaseId}`,
    };
  }

  async delete(identity: CmsIdentity, releaseId: string): Promise<void> {
    this.#publications.get(key(identity))?.delete(releaseId);
  }
}

/** Publishes immutable JSON payloads through the existing S3-compatible ObjectStore. */
export function createObjectStoreCmsPublisher(
  objectStore: ObjectStore,
): CmsPublisher {
  return {
    async put(publication) {
      const body = new TextEncoder().encode(JSON.stringify(publication));
      return objectStore.upload({
        key: cmsStorageKey(publication.identity, publication.releaseId),
        body,
        contentType: "application/json; charset=utf-8",
        contentLength: body.byteLength,
        metadata: {
          "cms-schema": String(publication.schemaVersion),
          "cms-revision": publication.revision,
          "cms-locale": publication.identity.locale,
        },
      });
    },
    async delete(identity, releaseId) {
      await objectStore.delete({ key: cmsStorageKey(identity, releaseId) });
    },
  };
}

export function createCachedCmsReader(options: {
  reader: CmsPublicationReader;
  cache: Cache;
  ttlMs: number;
}): CmsPublicationReader {
  return {
    list(identity) {
      return options.cache.getOrLoad(
        `cms:${identity.kind}:${identity.key}:${identity.locale}`,
        () => options.reader.list(identity),
        { ttlMs: options.ttlMs },
      );
    },
  };
}
