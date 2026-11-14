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
      return deps.lifeLogs.list({
        ...input,
        userId: subjectUserId(input.actor),
        search: input.search?.trim() || undefined,
        type: input.type ? parseLifeLogType(input.type) : undefined,
      });
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
  };
}
