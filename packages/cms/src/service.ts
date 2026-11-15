import type { Cache } from "@life-optimizer/cache";
import { randomUUID } from "node:crypto";
import type {
  EvaluationContext,
  FeatureFlagEvaluator,
  FlagAccessPolicy,
} from "@life-optimizer/feature-flags";
import { hasFlagAccess } from "@life-optimizer/feature-flags";
import {
  createCmsDocument,
  editCmsDocument,
  materializeCmsDocument,
  normalizeCmsIdentity,
} from "./crdt.js";
import type {
  CmsChangeContext,
  CmsComponent,
  CmsCrdtDocument,
  CmsDocument,
  CmsIdentity,
  CmsOperation,
  CmsPublication,
  CmsResolvedPublication,
} from "./model.js";
import type {
  CmsDraftStore,
  CmsPublicationReader,
  CmsPublisher,
} from "./ports.js";

export interface CmsService {
  create(input: {
    identity: CmsIdentity;
    context: CmsChangeContext;
    fields?: CmsDocument["fields"];
    components?: readonly CmsComponent[];
  }): Promise<CmsDocument>;
  edit(input: {
    identity: CmsIdentity;
    context: CmsChangeContext;
    operations: readonly CmsOperation[];
  }): Promise<CmsDocument>;
  delete(
    identity: CmsIdentity,
    context: CmsChangeContext,
  ): Promise<CmsDocument>;
  restore(
    identity: CmsIdentity,
    context: CmsChangeContext,
  ): Promise<CmsDocument>;
  getDraft(identity: CmsIdentity): Promise<CmsDocument | null>;
  publish(input: {
    identity: CmsIdentity;
    releaseId?: string;
    publishAt?: Date;
    expiresAt?: Date;
  }): Promise<CmsPublication>;
  unpublish(identity: CmsIdentity, releaseId: string): Promise<void>;
  resolve(input: {
    kind: CmsIdentity["kind"];
    key: string;
    locales: readonly string[];
    evaluationContext: EvaluationContext;
  }): Promise<CmsResolvedPublication | null>;
  /** Structurally implements core's CompliancePolicyReader without importing core. */
  isPublishedVersion(input: {
    policyKey: string;
    policyVersion: string;
    locale: string;
    at: Date;
  }): Promise<boolean>;
}

export function createCmsService(options: {
  drafts: CmsDraftStore;
  publications: CmsPublicationReader;
  publisher: CmsPublisher;
  featureFlags: FeatureFlagEvaluator;
  cache?: Cache;
  now?: () => Date;
}): CmsService {
  const now = options.now ?? (() => new Date());
  const loadDraft = async (identity: CmsIdentity): Promise<CmsCrdtDocument> => {
    const draft = await options.drafts.get(normalizeCmsIdentity(identity));
    if (!draft) throw new Error("CMS document was not found.");
    return draft;
  };
  const mutate = async (
    identity: CmsIdentity,
    context: CmsChangeContext,
    operations: readonly CmsOperation[],
  ) => {
    const current = await loadDraft(identity);
    const edited = editCmsDocument({
      document: current,
      context,
      operations,
      now: now(),
    });
    await options.drafts.save(edited.document);
    return materializeCmsDocument(edited.document);
  };
  const invalidate = async (identity: CmsIdentity) => {
    await options.cache?.invalidate(cacheKey(identity));
  };

  return {
    async create(input) {
      const identity = normalizeCmsIdentity(input.identity);
      if (await options.drafts.get(identity))
        throw new Error("CMS document already exists.");
      const crdt = createCmsDocument({ ...input, identity, now: now() });
      await options.drafts.save(crdt);
      return materializeCmsDocument(crdt);
    },
    edit: (input) => mutate(input.identity, input.context, input.operations),
    delete: (identity, context) =>
      mutate(identity, context, [{ kind: "delete-document" }]),
    restore: (identity, context) =>
      mutate(identity, context, [{ kind: "restore-document" }]),
    async getDraft(identity) {
      const draft = await options.drafts.get(normalizeCmsIdentity(identity));
      return draft ? materializeCmsDocument(draft) : null;
    },
    async publish(input) {
      const draft = materializeCmsDocument(await loadDraft(input.identity));
      if (draft.deleted)
        throw new Error("Deleted CMS content cannot be published.");
      if (
        draft.identity.key.startsWith("policies/") &&
        draft.components.some((component) => component.gate !== undefined)
      )
        throw new Error("Compliance policy content cannot use feature flags.");
      const publishedAt = now();
      const publishAt = input.publishAt ?? publishedAt;
      if (!Number.isFinite(publishAt.getTime()))
        throw new Error("CMS publishAt is invalid.");
      if (
        input.expiresAt !== undefined &&
        (!Number.isFinite(input.expiresAt.getTime()) ||
          input.expiresAt <= publishAt)
      )
        throw new Error("CMS expiresAt must be later than publishAt.");
      const releaseId = input.releaseId ?? randomUUID();
      if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(releaseId))
        throw new Error("CMS release ID must be a bounded lowercase key.");
      const publication: CmsPublication = {
        schemaVersion: 1,
        identity: draft.identity,
        revision: draft.revision,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        fields: draft.fields,
        components: draft.components,
        releaseId,
        publishAt: publishAt.toISOString(),
        ...(input.expiresAt === undefined
          ? {}
          : { expiresAt: input.expiresAt.toISOString() }),
        publishedAt: publishedAt.toISOString(),
      };
      await options.publisher.put(publication);
      await invalidate(draft.identity);
      return publication;
    },
    async unpublish(identity, releaseId) {
      const normalized = normalizeCmsIdentity(identity);
      await options.publisher.delete(normalized, releaseId);
      await invalidate(normalized);
    },
    async resolve(input) {
      let releases: readonly CmsPublication[] = [];
      let ordered: CmsPublication[] = [];
      let publication: CmsPublication | undefined;
      const at = now();
      for (const locale of input.locales) {
        const identity = normalizeCmsIdentity({
          kind: input.kind,
          key: input.key,
          locale,
        });
        releases = options.cache
          ? await options.cache.getOrLoad(cacheKey(identity), () =>
              options.publications.list(identity),
            )
          : await options.publications.list(identity);
        ordered = [...releases].sort(comparePublications);
        publication = ordered
          .filter(
            (candidate) =>
              new Date(candidate.publishAt) <= at &&
              (candidate.expiresAt === undefined ||
                new Date(candidate.expiresAt) > at),
          )
          .at(-1);
        if (publication) break;
      }
      if (!publication) return null;
      const flagKeys = new Set<string>();
      for (const component of publication.components)
        if (component.gate) collectFlagKeys(component.gate, flagKeys);
      const decisions = await options.featureFlags.evaluateMany(
        [...flagKeys],
        input.evaluationContext,
      );
      const byId = new Map(
        publication.components.map((component) => [component.id, component]),
      );
      const memo = new Map<string, boolean>();
      const visiting = new Set<string>();
      const visible = (component: CmsComponent): boolean => {
        const known = memo.get(component.id);
        if (known !== undefined) return known;
        if (visiting.has(component.id)) return false;
        visiting.add(component.id);
        const parent =
          component.parentId === null
            ? undefined
            : byId.get(component.parentId);
        const allowed =
          (!component.gate || hasFlagAccess(component.gate, decisions)) &&
          (component.parentId === null ||
            (parent !== undefined && visible(parent)));
        visiting.delete(component.id);
        memo.set(component.id, allowed);
        return allowed;
      };
      const components = publication.components.filter(visible);
      const nextStart = ordered
        .map((candidate) => candidate.publishAt)
        .filter((candidate) => new Date(candidate) > at)
        .sort()[0];
      const cacheUntil = [publication.expiresAt, nextStart]
        .filter((candidate): candidate is string => candidate !== undefined)
        .sort()[0];
      return {
        ...publication,
        components,
        ...(cacheUntil === undefined ? {} : { cacheUntil }),
      };
    },
    async isPublishedVersion(input) {
      if (!input.policyKey.startsWith("policies/")) return false;
      const identity = normalizeCmsIdentity({
        kind: "page",
        key: input.policyKey,
        locale: input.locale,
      });
      const releases = await options.publications.list(identity);
      return releases.some(
        (release) =>
          release.releaseId === input.policyVersion &&
          new Date(release.publishAt) <= input.at &&
          (release.expiresAt === undefined ||
            new Date(release.expiresAt) > input.at) &&
          release.components.every((component) => component.gate === undefined),
      );
    },
  };
}

function collectFlagKeys(policy: FlagAccessPolicy, keys: Set<string>): void {
  if (policy.kind === "flag") keys.add(policy.flagKey);
  else if (policy.kind === "not") collectFlagKeys(policy.policy, keys);
  else for (const child of policy.policies) collectFlagKeys(child, keys);
}

function cacheKey(identity: CmsIdentity): string {
  return `cms:${identity.kind}:${identity.key}:${identity.locale}`;
}

function comparePublications(
  left: CmsPublication,
  right: CmsPublication,
): number {
  return (
    left.publishAt.localeCompare(right.publishAt) ||
    left.publishedAt.localeCompare(right.publishedAt) ||
    left.releaseId.localeCompare(right.releaseId)
  );
}
