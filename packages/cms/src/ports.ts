import type { ObjectLocation } from "@life-optimizer/storage";
import type { CmsCrdtDocument, CmsIdentity, CmsPublication } from "./model.js";

export interface CmsDraftStore {
  get(identity: CmsIdentity): Promise<CmsCrdtDocument | null>;
  /** Must merge concurrent CRDT changes rather than replacing unseen changes. */
  save(document: CmsCrdtDocument): Promise<void>;
}

export interface CmsPublicationReader {
  list(identity: CmsIdentity): Promise<readonly CmsPublication[]>;
}

export interface CmsPublisher {
  put(publication: CmsPublication): Promise<ObjectLocation>;
  delete(identity: CmsIdentity, releaseId: string): Promise<void>;
}

export function cmsStorageKey(
  identity: CmsIdentity,
  releaseId: string,
): string {
  const segment = identity.kind === "page" ? "pages" : "screens";
  return `cms/${segment}/${identity.key}/${identity.locale}/releases/${releaseId}.json`;
}
