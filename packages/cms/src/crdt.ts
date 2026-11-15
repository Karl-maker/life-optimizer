import { createHash, randomUUID } from "node:crypto";
import { isJsonValue } from "@life-optimizer/util";
import type {
  CmsChange,
  CmsChangeContext,
  CmsComponent,
  CmsCrdtDocument,
  CmsDocument,
  CmsIdentity,
  CmsOperation,
} from "./model.js";

const KEY = /^[a-z0-9][a-z0-9._/-]{0,127}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const MAX_OPERATIONS = 100;
const MAX_COMPONENTS = 500;
const MAX_JSON_BYTES = 64 * 1024;

export function normalizeCmsIdentity(identity: CmsIdentity): CmsIdentity {
  if (
    !KEY.test(identity.key) ||
    identity.key
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  )
    throw new Error("CMS key must be a bounded lowercase route key.");
  let locales: string[];
  try {
    locales = Intl.getCanonicalLocales(identity.locale);
  } catch {
    throw new Error("CMS locale must be a valid BCP 47 language tag.");
  }
  const locale = locales[0];
  if (!locale) throw new Error("CMS locale is required.");
  return { ...identity, locale };
}

export function createCmsDocument(input: {
  identity: CmsIdentity;
  context: CmsChangeContext;
  fields?: Readonly<Record<string, import("@life-optimizer/util").JsonValue>>;
  components?: readonly CmsComponent[];
  now?: Date;
  changeId?: string;
}): CmsCrdtDocument {
  const identity = normalizeCmsIdentity(input.identity);
  const operations: CmsOperation[] = [];
  for (const [field, value] of Object.entries(input.fields ?? {}))
    operations.push({ kind: "set-field", field, value });
  for (const component of input.components ?? [])
    operations.push({ kind: "upsert-component", component });
  const occurredAt = (input.now ?? new Date()).toISOString();
  const change = makeChange({
    context: input.context,
    operations,
    clock: 1,
    occurredAt,
    ...(input.changeId === undefined ? {} : { changeId: input.changeId }),
  });
  const document = {
    schemaVersion: 1,
    identity,
    createdAt: occurredAt,
    changes: [change],
  } as const;
  materializeCmsDocument(document);
  return document;
}

export function editCmsDocument(input: {
  document: CmsCrdtDocument;
  context: CmsChangeContext;
  operations: readonly CmsOperation[];
  now?: Date;
  changeId?: string;
}): { document: CmsCrdtDocument; change: CmsChange } {
  const clock =
    Math.max(0, ...input.document.changes.map((change) => change.clock)) + 1;
  const change = makeChange({
    context: input.context,
    operations: structuredClone(input.operations),
    clock,
    occurredAt: (input.now ?? new Date()).toISOString(),
    ...(input.changeId === undefined ? {} : { changeId: input.changeId }),
  });
  const document = mergeCmsDocuments(input.document, {
    ...input.document,
    changes: [change],
  });
  materializeCmsDocument(document);
  return { document, change };
}

export function mergeCmsDocuments(
  left: CmsCrdtDocument,
  right: CmsCrdtDocument,
): CmsCrdtDocument {
  if (identityKey(left.identity) !== identityKey(right.identity))
    throw new Error("Only matching CMS documents can be merged.");
  const changes = new Map<string, CmsChange>();
  for (const change of [...left.changes, ...right.changes]) {
    const existing = changes.get(change.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(change))
      throw new Error(`Conflicting CMS change ID: ${change.id}.`);
    changes.set(change.id, change);
  }
  return {
    schemaVersion: 1,
    identity: normalizeCmsIdentity(left.identity),
    createdAt:
      left.createdAt < right.createdAt ? left.createdAt : right.createdAt,
    changes: [...changes.values()].sort(compareChanges),
  };
}

export function materializeCmsDocument(document: CmsCrdtDocument): CmsDocument {
  if (document.schemaVersion !== 1)
    throw new Error("Unsupported CMS schema version.");
  const identity = normalizeCmsIdentity(document.identity);
  const fields: Record<string, import("@life-optimizer/util").JsonValue> = {};
  const components = new Map<string, CmsComponent>();
  let deleted = false;
  const changes = [...document.changes].sort(compareChanges);
  for (const change of changes) {
    validateChange(change);
    for (const operation of change.operations) {
      switch (operation.kind) {
        case "set-field":
          fields[operation.field] = operation.value;
          break;
        case "remove-field":
          delete fields[operation.field];
          break;
        case "upsert-component":
          components.set(operation.component.id, operation.component);
          break;
        case "remove-component":
          components.delete(operation.componentId);
          break;
        case "delete-document":
          deleted = true;
          break;
        case "restore-document":
          deleted = false;
          break;
      }
    }
  }
  const ordered = [...components.values()].sort(
    (left, right) =>
      (left.parentId ?? "").localeCompare(right.parentId ?? "") ||
      left.position - right.position ||
      left.id.localeCompare(right.id),
  );
  validateTree(ordered);
  const updatedAt = changes.at(-1)?.occurredAt ?? document.createdAt;
  return {
    schemaVersion: 1,
    identity,
    revision: revision(changes),
    createdAt: document.createdAt,
    updatedAt,
    deleted,
    fields,
    components: ordered,
  };
}

function makeChange(input: {
  context: CmsChangeContext;
  operations: readonly CmsOperation[];
  clock: number;
  occurredAt: string;
  changeId?: string;
}): CmsChange {
  const change: CmsChange = {
    id: input.changeId ?? randomUUID(),
    actorId: input.context.actorId,
    correlationId: input.context.correlationId,
    clock: input.clock,
    occurredAt: input.occurredAt,
    operations: input.operations,
  };
  validateChange(change);
  return change;
}

function validateChange(change: CmsChange): void {
  if (
    !change.id ||
    change.id.length > 128 ||
    !change.actorId ||
    change.actorId.length > 256
  )
    throw new Error("CMS change and actor IDs must be present and bounded.");
  if (!change.correlationId || change.correlationId.length > 256)
    throw new Error("CMS correlation ID must be present and bounded.");
  if (!Number.isSafeInteger(change.clock) || change.clock < 1)
    throw new Error("CMS logical clock must be a positive safe integer.");
  if (change.operations.length > MAX_OPERATIONS)
    throw new Error(`A CMS change cannot exceed ${MAX_OPERATIONS} operations.`);
  for (const operation of change.operations) validateOperation(operation);
}

function validateOperation(operation: CmsOperation): void {
  if (operation.kind === "set-field" || operation.kind === "remove-field") {
    if (!FIELD.test(operation.field))
      throw new Error("CMS field key is invalid.");
    if (operation.kind === "set-field") assertJson(operation.value);
    return;
  }
  if (operation.kind === "remove-component") {
    if (!KEY.test(operation.componentId))
      throw new Error("CMS component ID is invalid.");
    return;
  }
  if (operation.kind === "upsert-component")
    validateComponent(operation.component);
}

function validateComponent(component: CmsComponent): void {
  if (!KEY.test(component.id) || !KEY.test(component.type))
    throw new Error(
      "CMS component ID and type must be bounded lowercase keys.",
    );
  if (component.parentId !== null && !KEY.test(component.parentId))
    throw new Error("CMS component parent ID is invalid.");
  if (!Number.isSafeInteger(component.position))
    throw new Error("CMS component position must be a safe integer.");
  assertJson(component.props);
  if (component.variants !== undefined) assertJson(component.variants);
}

function assertJson(value: unknown): void {
  if (!isJsonValue(value) || JSON.stringify(value).length > MAX_JSON_BYTES)
    throw new Error("CMS values must be bounded, finite JSON data.");
}

function validateTree(components: readonly CmsComponent[]): void {
  if (components.length > MAX_COMPONENTS)
    throw new Error(
      `A CMS document cannot exceed ${MAX_COMPONENTS} components.`,
    );
  const byId = new Map(
    components.map((component) => [component.id, component]),
  );
  for (const component of components) {
    if (component.parentId !== null && !byId.has(component.parentId))
      throw new Error(`CMS component ${component.id} has a missing parent.`);
    const seen = new Set<string>([component.id]);
    let parent = component.parentId;
    while (parent !== null) {
      if (seen.has(parent))
        throw new Error("CMS component tree contains a cycle.");
      seen.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
  }
}

function compareChanges(left: CmsChange, right: CmsChange): number {
  return (
    left.clock - right.clock ||
    left.actorId.localeCompare(right.actorId) ||
    left.id.localeCompare(right.id)
  );
}

function revision(changes: readonly CmsChange[]): string {
  return createHash("sha256")
    .update(changes.map((change) => change.id).join("\0"))
    .digest("hex");
}

function identityKey(identity: CmsIdentity): string {
  const normalized = normalizeCmsIdentity(identity);
  return `${normalized.kind}:${normalized.key}:${normalized.locale}`;
}
