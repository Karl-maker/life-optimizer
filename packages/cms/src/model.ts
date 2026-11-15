import type { FlagAccessPolicy } from "@life-optimizer/feature-flags";
import type { JsonValue } from "@life-optimizer/util";

export type CmsTargetKind = "page" | "screen";

export interface CmsIdentity {
  kind: CmsTargetKind;
  /** Stable route/screen key, not a display label. */
  key: string;
  /** Canonical BCP 47 language tag, for example `en`, `en-TT`, or `es-419`. */
  locale: string;
}

export interface CmsComponent {
  id: string;
  /** Client-owned, allow-listed renderer key such as text, button, or highlight. */
  type: string;
  parentId: string | null;
  /** Stable integer ordering within the same parent. Gaps allow cheap insertions. */
  position: number;
  /** JSON-only presentation data: text, action, color token, image reference, etc. */
  props: Readonly<Record<string, JsonValue>>;
  /** Optional responsive/platform overrides interpreted by trusted clients. */
  variants?: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  /** The component is returned only when this policy passes for the current user. */
  gate?: FlagAccessPolicy;
}

export type CmsOperation =
  | { kind: "set-field"; field: string; value: JsonValue }
  | { kind: "remove-field"; field: string }
  | { kind: "upsert-component"; component: CmsComponent }
  | { kind: "remove-component"; componentId: string }
  | { kind: "delete-document" }
  | { kind: "restore-document" };

/** Immutable, user-attributed operation batch; this is the CMS audit record. */
export interface CmsChange {
  id: string;
  actorId: string;
  correlationId: string;
  clock: number;
  occurredAt: string;
  operations: readonly CmsOperation[];
}

/** Operation-set CRDT. Merge is union by change ID plus deterministic replay. */
export interface CmsCrdtDocument {
  schemaVersion: 1;
  identity: CmsIdentity;
  createdAt: string;
  changes: readonly CmsChange[];
}

export interface CmsDocument {
  schemaVersion: 1;
  identity: CmsIdentity;
  revision: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  fields: Readonly<Record<string, JsonValue>>;
  components: readonly CmsComponent[];
}

export interface CmsPublication extends Omit<CmsDocument, "deleted"> {
  /** Stable identifier for this independently scheduled static release. */
  releaseId: string;
  /** The release becomes eligible at this instant. */
  publishAt: string;
  /** Exclusive end instant. Omit when the release has no scheduled end. */
  expiresAt?: string;
  publishedAt: string;
}

export interface CmsResolvedPublication extends CmsPublication {
  /** Earliest of this release's expiry and the next release's start. */
  cacheUntil?: string;
}

export interface CmsChangeContext {
  actorId: string;
  correlationId: string;
}
