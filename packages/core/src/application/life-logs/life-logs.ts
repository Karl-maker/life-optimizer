import {
  assertCan,
  subjectUserId,
  type Actor,
} from "../../domain/actor/index.js";
import {
  LIFE_LOG_LIMITS,
  normalizeLifeLogText,
  parseLifeLogType,
  parseLifeLogTimestamp,
  type LifeLog,
} from "../../domain/life-log/index.js";
import { DomainError } from "../../domain/errors/index.js";
import { AUDIT_ACTION, type AuditContext } from "../audit/audit-event.js";
import type {
  LifeLogRepository,
  LifeLogQuery,
} from "../ports/life-log-repository.js";
import type { OperationLog } from "../ports/operation-log.js";
import type { TransactionRunner } from "../ports/transaction-runner.js";

export interface LifeLogDraft {
  description: string;
  type: string;
  timestamp?: string | undefined;
  timeZone: string;
  metadataKey?: string | undefined;
  metadataValue?: string | undefined;
  agentSessionId?: string | undefined;
}

export interface UpdateAgentLifeLogInput {
  actor: Actor;
  audit: AuditContext;
  sessionId: string;
  logId: string;
  patch: {
    description?: string | undefined;
    type?: string | undefined;
    timestamp?: string | undefined;
    timeZone?: string | undefined;
  };
}

export interface AddLifeLogsInput {
  actor: Actor;
  logs: readonly LifeLogDraft[];
  audit: AuditContext;
}

export const createLifeLogService = (deps: {
  lifeLogs: LifeLogRepository;
  transactions: TransactionRunner;
  clock?: () => Date;
  operationLog?: OperationLog;
}) => {
  const clock = deps.clock ?? (() => new Date());
  return {
    async add(input: AddLifeLogsInput): Promise<readonly LifeLog[]> {
      assertCan(input.actor, "life-logs:write");
      if (input.logs.length === 0 || input.logs.length > LIFE_LOG_LIMITS.batch)
        throw new DomainError(
          "INVALID_LIFE_LOG",
          `A batch must contain 1-${LIFE_LOG_LIMITS.batch} logs.`,
          { maxBatchSize: LIFE_LOG_LIMITS.batch },
        );
      const userId = subjectUserId(input.actor);
      const now = clock();
      const normalized = input.logs.map((draft) =>
        normalizeDraft(draft, userId, now),
      );
      const created = await deps.transactions.run(
        async ({ lifeLogs, audit }) => {
          const values = await lifeLogs.createMany(normalized);
          for (const value of values)
            await audit.append({
              occurredAt: now,
              companyId: null,
              actor: input.actor,
              action: AUDIT_ACTION.lifeLogCreated,
              outcome: "succeeded",
              resource: { type: "life-log", id: value.id },
              context: input.audit,
              changes: {
                type: value.type,
                occurredAt: value.occurredAt.toISOString(),
                timeZone: value.timeZone,
                hasMetadata: value.metadataKey !== null,
              },
            });
          return values;
        },
      );
      deps.operationLog?.info(
        "life_log.created",
        { count: created.length, userId },
        input.audit.correlationId,
      );
      return created;
    },
    async list(
      input: Omit<LifeLogQuery, "userId"> & { actor: Actor },
    ): Promise<readonly LifeLog[]> {
      assertCan(input.actor, "life-logs:read");
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 500
      )
        throw new DomainError(
          "INVALID_LIFE_LOG_QUERY",
          "limit must be an integer from 1 to 500.",
          { maxLimit: 500 },
        );
      if (input.from && input.to && input.from > input.to)
        throw new DomainError(
          "INVALID_LIFE_LOG_QUERY",
          "from must be before or equal to to.",
        );
      const regex = normalizeRegex(input.regex);
      return deps.lifeLogs.list({
        ...input,
        userId: subjectUserId(input.actor),
        search: input.search?.trim() || undefined,
        type: input.type ? parseLifeLogType(input.type) : undefined,
        regex,
      });
    },
    async updateAgentCreated(input: UpdateAgentLifeLogInput): Promise<LifeLog> {
      assertCan(input.actor, "life-logs:write");
      const userId = subjectUserId(input.actor);
      const sessionId = normalizeAgentSessionId(input.sessionId);
      if (!Object.values(input.patch).some((value) => value !== undefined))
        throw new DomainError(
          "INVALID_LIFE_LOG",
          "At least one life-log field must be supplied for an update.",
        );
      const now = clock();
      const updated = await deps.transactions.run(
        async ({ lifeLogs, audit }) => {
          const existing = await lifeLogs.findById(input.logId);
          if (
            !existing ||
            existing.userId !== userId ||
            existing.agentSessionId !== sessionId
          )
            throw new DomainError(
              "FORBIDDEN",
              "An agent can update only a life log created by the same agent session.",
            );
          if (existing.type === "metadata")
            throw new DomainError(
              "FORBIDDEN",
              "Agent updates cannot modify metadata logs.",
            );
          const timestamp = parseLifeLogTimestamp({
            timestamp:
              input.patch.timestamp ?? existing.occurredAt.toISOString(),
            timeZone: input.patch.timeZone ?? existing.timeZone,
          });
          const value = await lifeLogs.update({
            ...existing,
            description:
              input.patch.description === undefined
                ? existing.description
                : normalizeLifeLogText(input.patch.description, "description"),
            type:
              input.patch.type === undefined
                ? existing.type
                : parseLifeLogType(input.patch.type),
            ...timestamp,
          });
          await audit.append({
            occurredAt: now,
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.lifeLogUpdated,
            outcome: "succeeded",
            resource: { type: "life-log", id: value.id },
            context: input.audit,
            changes: { agentSessionId: sessionId, type: value.type },
          });
          return value;
        },
      );
      deps.operationLog?.info(
        "life_log.updated",
        { logId: updated.id, userId, agentSessionId: sessionId },
        input.audit.correlationId,
      );
      return updated;
    },
  };
};

function normalizeDraft(draft: LifeLogDraft, userId: string, now: Date) {
  const metadataKey =
    draft.metadataKey === undefined
      ? null
      : normalizeLifeLogText(draft.metadataKey, "metadataKey");
  const metadataValue =
    draft.metadataValue === undefined
      ? null
      : normalizeLifeLogText(draft.metadataValue, "metadataValue");
  if ((metadataKey === null) !== (metadataValue === null))
    throw new DomainError(
      "INVALID_LIFE_LOG",
      "metadataKey and metadataValue must be supplied together.",
    );
  const type = parseLifeLogType(draft.type);
  if (type === "metadata" && metadataKey === null)
    throw new DomainError(
      "INVALID_LIFE_LOG",
      "metadata logs require metadataKey and metadataValue; use the metadata add command.",
    );
  if (type !== "metadata" && metadataKey !== null)
    throw new DomainError(
      "INVALID_LIFE_LOG",
      "metadataKey and metadataValue are only valid for metadata logs.",
    );
  return {
    userId,
    description: normalizeLifeLogText(draft.description, "description"),
    type,
    ...parseLifeLogTimestamp({
      timestamp: draft.timestamp,
      timeZone: draft.timeZone,
      now,
    }),
    metadataKey,
    metadataValue,
    agentSessionId:
      draft.agentSessionId === undefined
        ? null
        : normalizeAgentSessionId(draft.agentSessionId),
  };
}

function normalizeRegex(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const pattern = value.trim();
  if (pattern.length > 256)
    throw new DomainError(
      "INVALID_LIFE_LOG_QUERY",
      "regex must be at most 256 characters.",
    );
  try {
    new RegExp(pattern, "iu");
  } catch {
    throw new DomainError(
      "INVALID_LIFE_LOG_QUERY",
      `"${pattern}" is not a valid regular expression.`,
    );
  }
  return pattern;
}

function normalizeAgentSessionId(value: string): string {
  const sessionId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(sessionId))
    throw new DomainError(
      "INVALID_LIFE_LOG",
      "agentSessionId must contain 1-100 letters, numbers, underscores, or hyphens.",
    );
  return sessionId;
}
