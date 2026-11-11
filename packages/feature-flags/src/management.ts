import { createFeatureFlagEvaluator } from "./evaluator.js";
import { defineFlag } from "./schema.js";
import type {
  EvaluationContext,
  ExposureRecorder,
  FlagDecision,
  FlagDefinition,
  JsonValue,
} from "./types.js";

export interface FeatureFlagUserOverride {
  flagKey: string;
  userId: string;
  enabled: boolean;
  variantKey: string | null;
}

export interface FeatureFlagRepository {
  list(): Promise<readonly FlagDefinition[]>;
  find(key: string): Promise<FlagDefinition | null>;
  save(flag: FlagDefinition): Promise<FlagDefinition>;
  delete(key: string): Promise<boolean>;
  findOverride(
    key: string,
    userId: string,
  ): Promise<FeatureFlagUserOverride | null>;
  saveOverride(
    value: FeatureFlagUserOverride,
  ): Promise<FeatureFlagUserOverride>;
  deleteOverride(key: string, userId: string): Promise<boolean>;
}

export interface FeatureFlagChangeAudit {
  record(input: {
    action:
      "created" | "updated" | "deleted" | "override_set" | "override_deleted";
    flagKey: string;
    actorId: string;
    correlationId: string;
    userId?: string;
  }): Promise<void>;
}

/** Persisted management and evaluation. A user override is evaluated before targeting rules. */
export function createFeatureFlagManagementService(options: {
  repository: FeatureFlagRepository;
  recorder: ExposureRecorder;
  audit: FeatureFlagChangeAudit;
}) {
  async function evaluate(
    key: string,
    context: EvaluationContext,
  ): Promise<FlagDecision> {
    const flag = await options.repository.find(key);
    if (!flag) throw new Error(`Unknown feature flag: ${key}.`);
    const override = await options.repository.findOverride(
      key,
      context.targetingKey,
    );
    if (override) {
      const variant = override.enabled
        ? (override.variantKey ?? flag.defaultVariant)
        : flag.offVariant;
      const definition = flag.variants.find((item) => item.key === variant);
      if (!definition)
        throw new Error(
          `Feature flag override references unknown variant: ${variant}.`,
        );
      const decision: FlagDecision = {
        flagKey: flag.key,
        flagVersion: flag.version,
        targetingKey: context.targetingKey,
        variant,
        value: definition.value,
        reason: override.enabled ? "rule_match" : "disabled",
        matchedRuleId: "user-override",
        assignmentId: `${flag.key}:${flag.version}:${context.targetingKey}:${variant}`,
        evaluationId: crypto.randomUUID(),
      };
      await options.recorder.record({
        ...decision,
        occurredAt: new Date(),
        ...(context.correlationId
          ? { correlationId: context.correlationId }
          : {}),
      });
      return decision;
    }
    return createFeatureFlagEvaluator({
      flags: [flag],
      recorder: options.recorder,
    }).evaluate(key, context);
  }

  return {
    list: () => options.repository.list(),
    get: (key: string) => options.repository.find(key),
    evaluate,
    async evaluateAll(context: EvaluationContext) {
      const flags = await options.repository.list();
      return Promise.all(flags.map((flag) => evaluate(flag.key, context)));
    },
    async save(input: {
      flag: FlagDefinition;
      actorId: string;
      correlationId: string;
    }) {
      const flag = defineFlag(input.flag);
      const existed = await options.repository.find(flag.key);
      const saved = await options.repository.save(flag);
      await options.audit.record({
        action: existed ? "updated" : "created",
        flagKey: flag.key,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      return saved;
    },
    async remove(input: {
      key: string;
      actorId: string;
      correlationId: string;
    }) {
      const deleted = await options.repository.delete(input.key);
      if (deleted)
        await options.audit.record({
          action: "deleted",
          flagKey: input.key,
          actorId: input.actorId,
          correlationId: input.correlationId,
        });
      return deleted;
    },
    async setOverride(
      input: FeatureFlagUserOverride & {
        actorId: string;
        correlationId: string;
      },
    ) {
      const flag = await options.repository.find(input.flagKey);
      if (!flag) throw new Error(`Unknown feature flag: ${input.flagKey}.`);
      if (
        input.variantKey &&
        !flag.variants.some((item) => item.key === input.variantKey)
      )
        throw new Error(`Unknown feature flag variant: ${input.variantKey}.`);
      const saved = await options.repository.saveOverride(input);
      await options.audit.record({
        action: "override_set",
        flagKey: input.flagKey,
        userId: input.userId,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      return saved;
    },
    async removeOverride(input: {
      key: string;
      userId: string;
      actorId: string;
      correlationId: string;
    }) {
      const deleted = await options.repository.deleteOverride(
        input.key,
        input.userId,
      );
      if (deleted)
        await options.audit.record({
          action: "override_deleted",
          flagKey: input.key,
          userId: input.userId,
          actorId: input.actorId,
          correlationId: input.correlationId,
        });
      return deleted;
    },
  };
}

export type FeatureFlagManagementService = ReturnType<
  typeof createFeatureFlagManagementService
>;

export function flagEnabled(decision: {
  value: JsonValue;
  variant: string;
}): boolean {
  return typeof decision.value === "boolean"
    ? decision.value
    : decision.variant !== "off";
}
