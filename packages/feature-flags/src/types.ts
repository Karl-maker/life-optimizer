export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type ContextValue = JsonPrimitive | readonly JsonPrimitive[];

/** Trusted attributes supplied by the host. Never pass raw request objects. */
export interface EvaluationContext {
  /** Stable subject identifier used for deterministic assignment, normally a user ID. */
  targetingKey: string;
  attributes: Readonly<Record<string, ContextValue>>;
  correlationId?: string;
}

export type AttributeCondition =
  | {
      kind: "attribute";
      attribute: string;
      operator: "equals" | "not_equals";
      value: JsonPrimitive;
    }
  | {
      kind: "attribute";
      attribute: string;
      operator: "one_of" | "not_one_of";
      values: readonly JsonPrimitive[];
    }
  | {
      kind: "attribute";
      attribute: string;
      operator: "contains";
      value: JsonPrimitive;
    }
  | {
      kind: "attribute";
      attribute: string;
      operator: "email_domain";
      domains: readonly string[];
      includeSubdomains?: boolean;
    }
  | {
      kind: "attribute";
      attribute: string;
      operator: "cidr";
      blocks: readonly string[];
    };

export type Condition =
  | AttributeCondition
  | { kind: "all"; conditions: readonly Condition[] }
  | { kind: "any"; conditions: readonly Condition[] }
  | { kind: "not"; condition: Condition }
  | {
      kind: "custom";
      name: string;
      parameters: Readonly<Record<string, JsonValue>>;
    };

export interface VariantDefinition {
  key: string;
  /** Provider-neutral remote configuration, or a reference such as a product ID. */
  value: JsonValue;
}

export type RuleServe =
  | { kind: "variant"; variant: string }
  | {
      kind: "rollout";
      /** Basis points make percentages exact: 2,500 is 25%. */
      allocations: readonly { variant: string; basisPoints: number }[];
      /** Stable salt; change it only when intentionally reshuffling subjects. */
      salt: string;
    };

export interface TargetingRule {
  /** Stable across configuration edits so assignments do not move accidentally. */
  id: string;
  description?: string;
  when: Condition;
  serve: RuleServe;
}

export interface FlagDefinition {
  schemaVersion: 1;
  key: string;
  /** Immutable configuration revision included in every exposure record. */
  version: string;
  enabled: boolean;
  offVariant: string;
  defaultVariant: string;
  variants: readonly VariantDefinition[];
  /** First matching rule wins. An unallocated rollout bucket falls through. */
  rules: readonly TargetingRule[];
}

export type EvaluationReason = "disabled" | "rule_match" | "default";

export interface FlagDecision {
  flagKey: string;
  flagVersion: string;
  targetingKey: string;
  variant: string;
  value: JsonValue;
  reason: EvaluationReason;
  matchedRuleId?: string;
  bucket?: number;
  assignmentId: string;
  evaluationId: string;
}

/** Deliberately excludes targeting attributes to avoid copying PII into audit storage. */
export interface ExposureRecord extends FlagDecision {
  occurredAt: Date;
  correlationId?: string;
}

/** Implementations should append durably and make evaluationId idempotent. */
export interface ExposureRecorder {
  record(exposure: ExposureRecord): Promise<void>;
}

export type CustomConditionEvaluator = (
  parameters: Readonly<Record<string, JsonValue>>,
  context: EvaluationContext,
) => boolean;

export type CustomConditionEvaluators = Readonly<
  Record<string, CustomConditionEvaluator>
>;
