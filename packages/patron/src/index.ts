import {
  AUDIT_ACTION,
  DomainError,
  type Actor,
  type AuditContext,
  type AuditLog,
  type EventOutbox,
  type OperationLog,
} from "@edu-service/core";

const MAX_CREDITS = 9_223_372_036_854_775_807n;
const CONFIG_KEY = "default";

export type PatronTier = "T0" | "T1" | "T2" | "T3";
export type BudgetPressure = "green" | "yellow" | "orange" | "red";
export type ModelClass = "economy" | "standard" | "frontier";
export type PriorityLane = "best_effort" | "normal" | "high" | "front";
export type TaskQualitySensitivity = "low" | "medium" | "high";
export type CreditEntryKind = "grant" | "spend" | "adjustment";

export interface TierBand {
  min: number;
  max: number;
}

export interface TaskClassConfiguration {
  qualitySensitivity: TaskQualitySensitivity;
  estimatedCredits: bigint;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface PatronConfiguration {
  key: string;
  version: number;
  creditMicrousd: number;
  flatMode: boolean;
  budget: {
    period: "monthly";
    ceilingCredits: bigint;
    safetyBufferBps: number;
    promoReserveBps: number;
    poolShares: Record<PatronTier, number>;
  };
  scoring: {
    weights: {
      revenue: number;
      reliability: number;
      costEfficiency: number;
      advocacy: number;
      participation: number;
      engagement: number;
      tenure: number;
    };
    halfLifeDays: number;
    tierBands: Record<PatronTier, TierBand>;
    demotionGraceDays: number;
  };
  monthlyAllowances: Record<PatronTier, bigint>;
  taskClasses: Record<string, TaskClassConfiguration>;
  planFloors: Record<string, PatronTier>;
  updatedAt: Date;
}

export interface PatronBudgetPeriod {
  periodKey: string;
  pressure: BudgetPressure;
  spentCredits: bigint;
  plannedCredits: bigint;
  forecastCredits: bigint;
  poolBalances: Record<PatronTier, bigint>;
  updatedAt: Date;
}

export interface PatronActionCreditRule {
  key: string;
  description: string;
  creditDelta: bigint;
  guide: string;
  active: boolean;
  updatedAt: Date;
}

export interface PatronUserProfile {
  userId: string;
  valueScore: number;
  potentialScore: number;
  tier: PatronTier;
  provisional: boolean;
  periodStart: Date;
  periodEnd: Date;
  allowanceRemainingCredits: bigint;
  updatedAt: Date;
}

export interface PatronCreditEntry {
  id: string;
  userId: string;
  amountCredits: bigint;
  kind: CreditEntryKind;
  situationKey: string | null;
  description: string;
  idempotencyKey: string;
  occurredAt: Date;
}

export interface PatronDecision {
  tier: PatronTier;
  modelClass: ModelClass;
  priorityLane: PriorityLane;
  maxInputTokens: number;
  maxOutputTokens: number;
  estimatedCredits: bigint;
  fallbackModelClasses: readonly ModelClass[];
  reasonCode:
    | "flat_mode"
    | "normal_entitlement"
    | "quality_sensitive_upgrade"
    | "budget_pressure_degrade"
    | "user_allowance_exhausted";
  budgetPressure: BudgetPressure;
}

export interface PatronExplanation {
  profile: PatronUserProfile;
  creditBalance: bigint;
  recentCredits: readonly PatronCreditEntry[];
}

export interface PatronRepository {
  getConfiguration(key: string): Promise<PatronConfiguration | null>;
  saveConfiguration(config: PatronConfiguration): Promise<PatronConfiguration>;
  getBudgetPeriod(periodKey: string): Promise<PatronBudgetPeriod | null>;
  saveBudgetPeriod(period: PatronBudgetPeriod): Promise<PatronBudgetPeriod>;
  findActionCreditRule(key: string): Promise<PatronActionCreditRule | null>;
  saveActionCreditRule(
    rule: PatronActionCreditRule,
  ): Promise<PatronActionCreditRule>;
  getProfile(userId: string): Promise<PatronUserProfile | null>;
  saveProfile(profile: PatronUserProfile): Promise<PatronUserProfile>;
  addCreditEntry(
    input: Omit<PatronCreditEntry, "id">,
  ): Promise<{ entry: PatronCreditEntry; created: boolean }>;
  creditBalance(userId: string): Promise<bigint>;
  listCreditEntries(
    userId: string,
    limit: number,
  ): Promise<readonly PatronCreditEntry[]>;
  listProfiles(input: {
    limit: number;
    cursor?: string;
    tier?: PatronTier;
    search?: string;
  }): Promise<readonly PatronUserProfile[]>;
}

export interface PatronTransactionRunner {
  run<T>(
    work: (ports: {
      patron: PatronRepository;
      audit: AuditLog;
      events: EventOutbox;
    }) => Promise<T>,
  ): Promise<T>;
}

const event = (
  type: string,
  occurredAt: Date,
  payload: Record<string, string | number | boolean | null>,
) => ({ topic: "patron", type, version: 1 as const, occurredAt, payload });

function assertManager(actor: Actor): void {
  if (actor.kind !== "agent" || !actor.permissions.includes("financial:manage"))
    throw new DomainError(
      "FORBIDDEN",
      "A trusted financial manager is required.",
    );
}

function assertOwnUser(actor: Actor, userId: string): void {
  if ((actor.kind === "user" ? actor.userId : actor.onBehalfOf) !== userId)
    throw new DomainError(
      "FORBIDDEN",
      "The actor cannot change another user's Patron credits.",
    );
}

function assertKey(value: string, label: string): void {
  if (!/^[a-z][a-z0-9_.-]{1,95}$/.test(value))
    throw new DomainError(
      "INVALID_NAME",
      `${label} must be a stable lowercase key.`,
    );
}

function assertCredits(value: bigint, allowNegative = false): void {
  const magnitude = value < 0n ? -value : value;
  if (
    magnitude === 0n ||
    magnitude > MAX_CREDITS ||
    (!allowNegative && value < 0n)
  )
    throw new DomainError(
      "INVALID_NAME",
      "Credit amount must be a non-zero signed 64-bit integer.",
    );
}

function assertBoundedText(value: string, label: string, max: number): void {
  if (value.trim().length < 1 || value.length > max)
    throw new DomainError("INVALID_NAME", `${label} is invalid.`);
}

function assertScore(value: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new DomainError("INVALID_NAME", `${label} is invalid.`);
}

function assertPercentTotal(
  values: Record<string, number>,
  label: string,
): void {
  const entries = Object.entries(values);
  const total = entries.reduce((sum, [key, value]) => {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new DomainError(
        "INVALID_NAME",
        `${label} percentage ${key} must be between 0 and 1.`,
      );
    return sum + value;
  }, 0);
  if (Math.abs(total - 1) > 0.000_000_001)
    throw new DomainError("INVALID_NAME", `${label} percentages must total 1.`);
}

function assertConfiguration(config: PatronConfiguration): void {
  if (config.key !== CONFIG_KEY) assertKey(config.key, "Configuration key");
  if (
    !Number.isInteger(config.creditMicrousd) ||
    config.creditMicrousd < 1 ||
    config.creditMicrousd > 1_000_000_000
  )
    throw new DomainError("INVALID_NAME", "Credit unit is invalid.");
  assertCredits(config.budget.ceilingCredits);
  if (
    config.budget.safetyBufferBps < 0 ||
    config.budget.promoReserveBps < 0 ||
    config.budget.safetyBufferBps + config.budget.promoReserveBps > 5000
  )
    throw new DomainError("INVALID_NAME", "Budget reserves are invalid.");
  assertPercentTotal(config.budget.poolShares, "Tier pool share");
  assertPercentTotal(config.scoring.weights, "Scoring weight");
  for (const tier of tiers) {
    assertCredits(config.monthlyAllowances[tier]);
    const band = config.scoring.tierBands[tier];
    if (
      !Number.isInteger(band.min) ||
      !Number.isInteger(band.max) ||
      band.min < 0 ||
      band.max > 1000 ||
      band.min > band.max
    )
      throw new DomainError("INVALID_NAME", "Tier bands are invalid.");
  }
  for (const [key, task] of Object.entries(config.taskClasses)) {
    assertKey(key, "Task class");
    assertCredits(task.estimatedCredits);
    if (
      !["low", "medium", "high"].includes(task.qualitySensitivity) ||
      !Number.isInteger(task.maxInputTokens) ||
      !Number.isInteger(task.maxOutputTokens) ||
      task.maxInputTokens < 1 ||
      task.maxOutputTokens < 1
    )
      throw new DomainError("INVALID_NAME", "Task class config is invalid.");
  }
}

const tiers = ["T0", "T1", "T2", "T3"] as const;

export const defaultPatronConfiguration = (
  now = new Date(),
): PatronConfiguration => ({
  key: CONFIG_KEY,
  version: 1,
  creditMicrousd: 10_000,
  flatMode: false,
  budget: {
    period: "monthly",
    ceilingCredits: 100_000n,
    safetyBufferBps: 1000,
    promoReserveBps: 800,
    poolShares: { T0: 0.25, T1: 0.3, T2: 0.25, T3: 0.2 },
  },
  scoring: {
    weights: {
      revenue: 0.3,
      reliability: 0.15,
      costEfficiency: 0.2,
      advocacy: 0.12,
      participation: 0.08,
      engagement: 0.08,
      tenure: 0.07,
    },
    halfLifeDays: 60,
    tierBands: {
      T0: { min: 0, max: 299 },
      T1: { min: 300, max: 549 },
      T2: { min: 550, max: 749 },
      T3: { min: 750, max: 1000 },
    },
    demotionGraceDays: 14,
  },
  monthlyAllowances: { T0: 100n, T1: 300n, T2: 800n, T3: 2000n },
  taskClasses: {
    final_answer: {
      qualitySensitivity: "high",
      estimatedCredits: 8n,
      maxInputTokens: 16_000,
      maxOutputTokens: 2_000,
    },
    summary: {
      qualitySensitivity: "medium",
      estimatedCredits: 3n,
      maxInputTokens: 8_000,
      maxOutputTokens: 1_000,
    },
    background: {
      qualitySensitivity: "low",
      estimatedCredits: 1n,
      maxInputTokens: 4_000,
      maxOutputTokens: 500,
    },
  },
  planFloors: {},
  updatedAt: now,
});

function defaultProfile(
  userId: string,
  config: PatronConfiguration,
  now: Date,
): PatronUserProfile {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return {
    userId,
    valueScore: 400,
    potentialScore: 50,
    tier: "T1",
    provisional: true,
    periodStart: start,
    periodEnd: end,
    allowanceRemainingCredits: config.monthlyAllowances.T1,
    updatedAt: now,
  };
}

function modelClassFor(
  tier: PatronTier,
  sensitivity: TaskQualitySensitivity,
): ModelClass {
  if (tier === "T3") return "frontier";
  if (tier === "T2" && sensitivity === "high") return "frontier";
  if (tier === "T0" && sensitivity === "low") return "economy";
  return "standard";
}

function degrade(
  tier: PatronTier,
  sensitivity: TaskQualitySensitivity,
  pressure: BudgetPressure,
  current: ModelClass,
): { modelClass: ModelClass; reason: PatronDecision["reasonCode"] } {
  if (pressure === "green")
    return { modelClass: current, reason: "normal_entitlement" };
  if (
    pressure === "yellow" &&
    (tier === "T0" || (tier === "T1" && sensitivity === "low"))
  )
    return { modelClass: "economy", reason: "budget_pressure_degrade" };
  if (pressure === "orange" && (tier === "T0" || tier === "T1"))
    return { modelClass: "economy", reason: "budget_pressure_degrade" };
  if (pressure === "red" && tier !== "T3")
    return {
      modelClass:
        tier === "T2" && sensitivity === "high" ? "standard" : "economy",
      reason: "budget_pressure_degrade",
    };
  return { modelClass: current, reason: "normal_entitlement" };
}

function laneFor(tier: PatronTier, pressure: BudgetPressure): PriorityLane {
  if (pressure === "red" && (tier === "T0" || tier === "T1"))
    return "best_effort";
  return (
    {
      T0: "best_effort",
      T1: "normal",
      T2: "high",
      T3: "front",
    } as const
  )[tier];
}

function fallbackFor(modelClass: ModelClass): readonly ModelClass[] {
  if (modelClass === "frontier") return ["standard", "economy"];
  if (modelClass === "standard") return ["economy"];
  return [];
}

export function createPatronService(deps: {
  repository: PatronRepository;
  transactions: PatronTransactionRunner;
  clock?: () => Date;
  operationLog?: OperationLog;
}) {
  const clock = deps.clock ?? (() => new Date());
  const getConfig = async () =>
    (await deps.repository.getConfiguration(CONFIG_KEY)) ??
    defaultPatronConfiguration(clock());
  const getProfile = async (userId: string) => {
    const config = await getConfig();
    return (
      (await deps.repository.getProfile(userId)) ??
      defaultProfile(userId, config, clock())
    );
  };
  const recordCredits = async (input: {
    actor: Actor;
    audit: AuditContext;
    userId: string;
    amountCredits: bigint;
    kind: CreditEntryKind;
    situationKey?: string | null;
    description: string;
    idempotencyKey: string;
  }) => {
    assertCredits(input.amountCredits, true);
    assertBoundedText(input.description, "Description", 240);
    assertBoundedText(input.idempotencyKey, "Idempotency key", 180);
    if (input.situationKey) assertKey(input.situationKey, "Credit situation");
    const at = clock();
    const result = await deps.transactions.run(
      async ({ patron, audit, events }) => {
        const saved = await patron.addCreditEntry({
          userId: input.userId,
          amountCredits: input.amountCredits,
          kind: input.kind,
          situationKey: input.situationKey ?? null,
          description: input.description.trim(),
          idempotencyKey: input.idempotencyKey,
          occurredAt: at,
        });
        if (saved.created) {
          const action =
            input.amountCredits > 0n
              ? AUDIT_ACTION.patronCreditsAdded
              : AUDIT_ACTION.patronCreditsSubtracted;
          await audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action,
            outcome: "succeeded",
            resource: { type: "patron-credit-entry", id: saved.entry.id },
            context: input.audit,
            changes: {
              userId: input.userId,
              amountCredits: input.amountCredits.toString(),
              kind: input.kind,
              situationKey: input.situationKey ?? null,
            },
          });
          await events.append(
            event(
              input.amountCredits > 0n
                ? "patron.credits.added"
                : "patron.credits.subtracted",
              at,
              {
                userId: input.userId,
                entryId: saved.entry.id,
                amountCredits: input.amountCredits.toString(),
                kind: input.kind,
                situationKey: input.situationKey ?? null,
              },
            ),
          );
        }
        return saved;
      },
    );
    deps.operationLog?.info(
      result.created ? "patron.credits.recorded" : "patron.credits.duplicate",
      {
        userId: input.userId,
        amountCredits: input.amountCredits.toString(),
        kind: input.kind,
        situationKey: input.situationKey ?? null,
      },
      input.audit.correlationId,
    );
    return result.entry;
  };
  return {
    async configure(input: {
      actor: Actor;
      audit: AuditContext;
      config: PatronConfiguration;
    }) {
      assertManager(input.actor);
      assertConfiguration(input.config);
      const at = clock();
      const config = { ...input.config, updatedAt: at };
      const saved = await deps.transactions.run(
        async ({ patron, audit, events }) => {
          const value = await patron.saveConfiguration(config);
          await audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.patronConfigurationUpdated,
            outcome: "succeeded",
            resource: { type: "patron-config", id: value.key },
            context: input.audit,
            changes: {
              version: value.version,
              ceilingCredits: value.budget.ceilingCredits.toString(),
              flatMode: value.flatMode,
            },
          });
          await events.append(
            event("patron.configuration.updated", at, {
              key: value.key,
              version: value.version,
              flatMode: value.flatMode,
            }),
          );
          return value;
        },
      );
      deps.operationLog?.info(
        "patron.configuration.updated",
        { version: saved.version, flatMode: saved.flatMode },
        input.audit.correlationId,
      );
      return saved;
    },
    async configureActionCredit(input: {
      actor: Actor;
      audit: AuditContext;
      key: string;
      description: string;
      creditDelta: bigint;
      guide: string;
      active?: boolean;
    }) {
      assertManager(input.actor);
      assertKey(input.key, "Credit situation");
      assertCredits(input.creditDelta, true);
      assertBoundedText(input.description, "Description", 240);
      assertBoundedText(input.guide, "Guide", 1000);
      const at = clock();
      const rule = await deps.transactions.run(
        async ({ patron, audit, events }) => {
          const value = await patron.saveActionCreditRule({
            key: input.key,
            description: input.description.trim(),
            creditDelta: input.creditDelta,
            guide: input.guide.trim(),
            active: input.active ?? true,
            updatedAt: at,
          });
          await audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.patronActionCreditConfigured,
            outcome: "succeeded",
            resource: { type: "patron-action-credit", id: value.key },
            context: input.audit,
            changes: {
              creditDelta: value.creditDelta.toString(),
              active: value.active,
            },
          });
          await events.append(
            event("patron.action-credit.configured", at, {
              key: value.key,
              active: value.active,
              creditDelta: value.creditDelta.toString(),
            }),
          );
          return value;
        },
      );
      deps.operationLog?.info(
        "patron.action-credit.configured",
        {
          key: rule.key,
          active: rule.active,
          creditDelta: rule.creditDelta.toString(),
        },
        input.audit.correlationId,
      );
      return rule;
    },
    async applyCreditSituation(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      situationKey: string;
      idempotencyKey: string;
      multiplier?: number;
    }) {
      assertOwnUser(input.actor, input.userId);
      assertKey(input.situationKey, "Credit situation");
      assertBoundedText(input.idempotencyKey, "Idempotency key", 180);
      const multiplier = input.multiplier ?? 1;
      if (!Number.isInteger(multiplier) || multiplier < 1 || multiplier > 1000)
        throw new DomainError("INVALID_NAME", "Credit multiplier is invalid.");
      const rule = await deps.repository.findActionCreditRule(
        input.situationKey,
      );
      if (!rule || !rule.active)
        throw new DomainError(
          "INVALID_NAME",
          "Credit situation is not active.",
        );
      return recordCredits({
        actor: input.actor,
        audit: input.audit,
        userId: input.userId,
        amountCredits: rule.creditDelta * BigInt(multiplier),
        kind: rule.creditDelta > 0n ? "grant" : "spend",
        situationKey: rule.key,
        description: rule.description,
        idempotencyKey: input.idempotencyKey,
      });
    },
    async addCredits(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      amountCredits: bigint;
      description: string;
      idempotencyKey: string;
      situationKey?: string;
    }) {
      assertManager(input.actor);
      assertCredits(input.amountCredits);
      return recordCredits({ ...input, kind: "adjustment" });
    },
    async subtractCredits(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      amountCredits: bigint;
      description: string;
      idempotencyKey: string;
      situationKey?: string;
    }) {
      assertManager(input.actor);
      assertCredits(input.amountCredits);
      return recordCredits({
        ...input,
        amountCredits: -input.amountCredits,
        kind: "adjustment",
      });
    },
    async profile(userId: string) {
      return getProfile(userId);
    },
    async listProfiles(input: {
      limit: number;
      cursor?: string;
      tier?: PatronTier;
      search?: string;
    }) {
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100
      )
        throw new DomainError(
          "INVALID_NAME",
          "Patron limit must be between 1 and 100.",
        );
      return deps.repository.listProfiles(input);
    },
    async saveProfile(input: {
      actor: Actor;
      audit: AuditContext;
      profile: PatronUserProfile;
    }) {
      assertManager(input.actor);
      assertScore(input.profile.valueScore, 1000, "Value score");
      assertScore(input.profile.potentialScore, 100, "Potential score");
      assertCredits(input.profile.allowanceRemainingCredits);
      const at = clock();
      return deps.transactions.run(async ({ patron, audit, events }) => {
        const saved = await patron.saveProfile({
          ...input.profile,
          updatedAt: at,
        });
        await audit.append({
          occurredAt: at,
          companyId: null,
          actor: input.actor,
          action: AUDIT_ACTION.patronProfileUpdated,
          outcome: "succeeded",
          resource: { type: "patron-profile", id: saved.userId },
          context: input.audit,
          changes: {
            tier: saved.tier,
            valueScore: saved.valueScore,
            potentialScore: saved.potentialScore,
            provisional: saved.provisional,
          },
        });
        await events.append(
          event("patron.profile.updated", at, {
            userId: saved.userId,
            tier: saved.tier,
            valueScore: saved.valueScore,
          }),
        );
        return saved;
      });
    },
    async decide(
      userId: string,
      context: { taskClass: string },
    ): Promise<PatronDecision> {
      const [config, profile, budget] = await Promise.all([
        getConfig(),
        getProfile(userId),
        deps.repository.getBudgetPeriod(periodKey(clock())),
      ]);
      const pressure = budget?.pressure ?? "green";
      const task = config.taskClasses[context.taskClass];
      if (!task)
        throw new DomainError("INVALID_NAME", "Unknown Patron task class.");
      if (config.flatMode)
        return {
          tier: "T1",
          modelClass: "standard",
          priorityLane: "normal",
          maxInputTokens: task.maxInputTokens,
          maxOutputTokens: task.maxOutputTokens,
          estimatedCredits: task.estimatedCredits,
          fallbackModelClasses: ["economy"],
          reasonCode: "flat_mode",
          budgetPressure: pressure,
        };
      const balance = await deps.repository.creditBalance(userId);
      if (profile.allowanceRemainingCredits + balance < task.estimatedCredits)
        return {
          tier: profile.tier,
          modelClass: "economy",
          priorityLane: "best_effort",
          maxInputTokens: Math.max(1, Math.floor(task.maxInputTokens / 2)),
          maxOutputTokens: Math.max(1, Math.floor(task.maxOutputTokens / 2)),
          estimatedCredits: task.estimatedCredits,
          fallbackModelClasses: [],
          reasonCode: "user_allowance_exhausted",
          budgetPressure: pressure,
        };
      const base = modelClassFor(profile.tier, task.qualitySensitivity);
      const adjusted = degrade(
        profile.tier,
        task.qualitySensitivity,
        pressure,
        base,
      );
      const reason =
        adjusted.reason === "normal_entitlement" &&
        base === "frontier" &&
        profile.tier !== "T3"
          ? "quality_sensitive_upgrade"
          : adjusted.reason;
      return {
        tier: profile.tier,
        modelClass: adjusted.modelClass,
        priorityLane: laneFor(profile.tier, pressure),
        maxInputTokens:
          adjusted.reason === "budget_pressure_degrade"
            ? Math.max(1, Math.floor(task.maxInputTokens * 0.75))
            : task.maxInputTokens,
        maxOutputTokens:
          adjusted.reason === "budget_pressure_degrade"
            ? Math.max(1, Math.floor(task.maxOutputTokens * 0.75))
            : task.maxOutputTokens,
        estimatedCredits: task.estimatedCredits,
        fallbackModelClasses: fallbackFor(adjusted.modelClass),
        reasonCode: reason,
        budgetPressure: pressure,
      };
    },
    async report(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      actualCredits: bigint;
      idempotencyKey: string;
      description?: string;
    }) {
      assertOwnUser(input.actor, input.userId);
      assertCredits(input.actualCredits);
      return recordCredits({
        actor: input.actor,
        audit: input.audit,
        userId: input.userId,
        amountCredits: -input.actualCredits,
        kind: "spend",
        situationKey: "ai.usage",
        description: input.description ?? "AI usage reported",
        idempotencyKey: input.idempotencyKey,
      });
    },
    async pressure() {
      return deps.repository.getBudgetPeriod(periodKey(clock()));
    },
    async explain(userId: string): Promise<PatronExplanation> {
      const [profile, creditBalance, recentCredits] = await Promise.all([
        getProfile(userId),
        deps.repository.creditBalance(userId),
        deps.repository.listCreditEntries(userId, 20),
      ]);
      return { profile, creditBalance, recentCredits };
    },
  };
}

export function periodKey(now: Date): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}
