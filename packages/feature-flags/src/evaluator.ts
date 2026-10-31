import { createHash, randomUUID } from "node:crypto";
import { isInCidr } from "./cidr.js";
import { defineFlag } from "./schema.js";
import type {
  AttributeCondition,
  Condition,
  CustomConditionEvaluators,
  EvaluationContext,
  ExposureRecorder,
  FlagDecision,
  FlagDefinition,
  JsonPrimitive,
  RuleServe,
  VariantDefinition,
} from "./types.js";

function same(left: JsonPrimitive, right: JsonPrimitive): boolean {
  return left === right;
}

function matchesAttribute(
  condition: AttributeCondition,
  context: EvaluationContext,
): boolean {
  const actual = context.attributes[condition.attribute];
  if (actual === undefined) return false;
  switch (condition.operator) {
    case "equals":
    case "not_equals": {
      const matched = Array.isArray(actual)
        ? actual.some((value) => same(value, condition.value))
        : same(actual as JsonPrimitive, condition.value);
      return condition.operator === "equals" ? matched : !matched;
    }
    case "one_of":
    case "not_one_of": {
      const values: readonly JsonPrimitive[] = Array.isArray(actual)
        ? actual
        : [actual as JsonPrimitive];
      const matched = values.some((value) =>
        condition.values.some((expected) => same(value, expected)),
      );
      return condition.operator === "one_of" ? matched : !matched;
    }
    case "contains":
      return (
        Array.isArray(actual) &&
        actual.some((value) => same(value, condition.value))
      );
    case "email_domain": {
      if (typeof actual !== "string") return false;
      const at = actual.lastIndexOf("@");
      if (at < 1 || at === actual.length - 1) return false;
      const domain = actual.slice(at + 1).toLowerCase();
      return condition.domains.some(
        (candidate) =>
          domain === candidate ||
          (condition.includeSubdomains === true &&
            domain.endsWith(`.${candidate}`)),
      );
    }
    case "cidr":
      return (
        typeof actual === "string" &&
        condition.blocks.some((block) => isInCidr(actual, block))
      );
  }
}

function matches(
  condition: Condition,
  context: EvaluationContext,
  custom: CustomConditionEvaluators,
): boolean {
  switch (condition.kind) {
    case "attribute":
      return matchesAttribute(condition, context);
    case "all":
      return condition.conditions.every((child) =>
        matches(child, context, custom),
      );
    case "any":
      return condition.conditions.some((child) =>
        matches(child, context, custom),
      );
    case "not":
      return !matches(condition.condition, context, custom);
    case "custom": {
      const evaluator = custom[condition.name];
      if (!evaluator)
        throw new Error(
          `No evaluator registered for custom condition ${condition.name}.`,
        );
      return evaluator(condition.parameters, context);
    }
  }
}

function digest(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

function rollout(
  serve: Extract<RuleServe, { kind: "rollout" }>,
  flagKey: string,
  ruleId: string,
  targetingKey: string,
): { variant: string; bucket: number } | null {
  const bucket =
    digest(
      `${serve.salt}\0${flagKey}\0${ruleId}\0${targetingKey}`,
    ).readUInt32BE(0) % 10_000;
  let boundary = 0;
  for (const allocation of serve.allocations) {
    boundary += allocation.basisPoints;
    if (bucket < boundary) return { variant: allocation.variant, bucket };
  }
  return null;
}

function assignmentId(input: {
  flag: FlagDefinition;
  targetingKey: string;
  variant: string;
  ruleId?: string;
}): string {
  return digest(
    `${input.flag.key}\0${input.flag.version}\0${input.ruleId ?? "default"}\0${input.targetingKey}\0${input.variant}`,
  ).toString("hex");
}

function variant(flag: FlagDefinition, key: string): VariantDefinition {
  return flag.variants.find((candidate) => candidate.key === key)!;
}

function decide(
  flag: FlagDefinition,
  context: EvaluationContext,
  custom: CustomConditionEvaluators,
): FlagDecision {
  if (!context.targetingKey || context.targetingKey.length > 256)
    throw new Error("targetingKey must contain 1 to 256 characters.");
  let selected = flag.enabled ? flag.defaultVariant : flag.offVariant;
  let reason: FlagDecision["reason"] = flag.enabled ? "default" : "disabled";
  let matchedRuleId: string | undefined;
  let bucket: number | undefined;
  if (flag.enabled) {
    for (const rule of flag.rules) {
      if (!matches(rule.when, context, custom)) continue;
      const served =
        rule.serve.kind === "variant"
          ? { variant: rule.serve.variant }
          : rollout(rule.serve, flag.key, rule.id, context.targetingKey);
      if (!served) continue;
      selected = served.variant;
      bucket = "bucket" in served ? served.bucket : undefined;
      matchedRuleId = rule.id;
      reason = "rule_match";
      break;
    }
  }
  const result: FlagDecision = {
    flagKey: flag.key,
    flagVersion: flag.version,
    targetingKey: context.targetingKey,
    variant: selected,
    value: variant(flag, selected).value,
    reason,
    assignmentId: assignmentId({
      flag,
      targetingKey: context.targetingKey,
      variant: selected,
      ...(matchedRuleId === undefined ? {} : { ruleId: matchedRuleId }),
    }),
    evaluationId: randomUUID(),
    ...(matchedRuleId === undefined ? {} : { matchedRuleId }),
    ...(bucket === undefined ? {} : { bucket }),
  };
  return result;
}

export interface FeatureFlagEvaluator {
  evaluate(flagKey: string, context: EvaluationContext): Promise<FlagDecision>;
  evaluateMany(
    flagKeys: readonly string[],
    context: EvaluationContext,
  ): Promise<ReadonlyMap<string, FlagDecision>>;
}

/**
 * Creates an evaluator whose successful return guarantees that its exposure was
 * recorded. The recorder therefore belongs to durable application wiring, not telemetry.
 */
export function createFeatureFlagEvaluator(options: {
  flags: readonly FlagDefinition[];
  recorder: ExposureRecorder;
  customConditions?: CustomConditionEvaluators;
  now?: () => Date;
}): FeatureFlagEvaluator {
  const flags = new Map<string, FlagDefinition>();
  for (const candidate of options.flags) {
    const flag = defineFlag(candidate);
    if (flags.has(flag.key))
      throw new Error(`Duplicate flag key: ${flag.key}.`);
    flags.set(flag.key, flag);
  }
  const custom = options.customConditions ?? {};
  const now = options.now ?? (() => new Date());
  const evaluate = async (flagKey: string, context: EvaluationContext) => {
    const flag = flags.get(flagKey);
    if (!flag) throw new Error(`Unknown feature flag: ${flagKey}.`);
    const decision = decide(flag, context, custom);
    await options.recorder.record({
      ...decision,
      occurredAt: now(),
      ...(context.correlationId === undefined
        ? {}
        : { correlationId: context.correlationId }),
    });
    return decision;
  };
  return {
    evaluate,
    async evaluateMany(flagKeys, context) {
      const entries = await Promise.all(
        flagKeys.map(
          async (key) => [key, await evaluate(key, context)] as const,
        ),
      );
      return new Map(entries);
    },
  };
}
