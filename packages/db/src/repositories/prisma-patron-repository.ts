import { randomUUID } from "node:crypto";
import { DomainError } from "@life-optimizer/core";
import type {
  BudgetPressure,
  CreditEntryKind,
  PatronActionCreditRule,
  PatronBudgetPeriod,
  PatronConfiguration,
  PatronCreditEntry,
  PatronRepository,
  PatronTier,
  PatronUserProfile,
  TaskClassConfiguration,
} from "@life-optimizer/patron";
import type { PrismaClient } from "../generated/client.js";
import { Prisma } from "../generated/client.js";

type Client = Pick<
  PrismaClient,
  | "patronConfiguration"
  | "patronBudgetPeriod"
  | "patronActionCreditRule"
  | "patronUserProfile"
  | "patronCreditEntry"
>;

type JsonRecord = Record<string, unknown>;

export class PrismaPatronRepository implements PatronRepository {
  constructor(private readonly prisma: Client) {}

  async getConfiguration(key: string) {
    const row = await this.prisma.patronConfiguration.findUnique({
      where: { key },
    });
    return row ? configuration(row) : null;
  }

  async saveConfiguration(config: PatronConfiguration) {
    const data = configurationData(config);
    const row = await this.prisma.patronConfiguration.upsert({
      where: { key: config.key },
      create: { key: config.key, ...data },
      update: data,
    });
    return configuration(row);
  }

  async getBudgetPeriod(periodKey: string) {
    const row = await this.prisma.patronBudgetPeriod.findUnique({
      where: { periodKey },
    });
    return row ? budgetPeriod(row) : null;
  }

  async saveBudgetPeriod(period: PatronBudgetPeriod) {
    const data = {
      pressure: period.pressure,
      spentCredits: period.spentCredits,
      plannedCredits: period.plannedCredits,
      forecastCredits: period.forecastCredits,
      poolBalances: json(stringifyBigintRecord(period.poolBalances)),
      updatedAt: period.updatedAt,
    };
    const row = await this.prisma.patronBudgetPeriod.upsert({
      where: { periodKey: period.periodKey },
      create: { periodKey: period.periodKey, ...data },
      update: data,
    });
    return budgetPeriod(row);
  }

  async findActionCreditRule(key: string) {
    const row = await this.prisma.patronActionCreditRule.findUnique({
      where: { key },
    });
    return row ? actionCreditRule(row) : null;
  }

  async saveActionCreditRule(rule: PatronActionCreditRule) {
    const data = {
      description: rule.description,
      creditDelta: rule.creditDelta,
      guide: rule.guide,
      active: rule.active,
      updatedAt: rule.updatedAt,
    };
    const row = await this.prisma.patronActionCreditRule.upsert({
      where: { key: rule.key },
      create: { key: rule.key, ...data },
      update: data,
    });
    return actionCreditRule(row);
  }

  async getProfile(userId: string) {
    const row = await this.prisma.patronUserProfile.findUnique({
      where: { userId },
    });
    return row ? profile(row) : null;
  }

  async saveProfile(value: PatronUserProfile) {
    const data = {
      valueScore: value.valueScore,
      potentialScore: value.potentialScore,
      tier: value.tier,
      provisional: value.provisional,
      periodStart: value.periodStart,
      periodEnd: value.periodEnd,
      allowanceRemainingCredits: value.allowanceRemainingCredits,
      updatedAt: value.updatedAt,
    };
    const row = await this.prisma.patronUserProfile.upsert({
      where: { userId: value.userId },
      create: { userId: value.userId, ...data },
      update: data,
    });
    return profile(row);
  }

  async addCreditEntry(input: Omit<PatronCreditEntry, "id">) {
    const result = await this.prisma.patronCreditEntry.createMany({
      data: [{ id: randomUUID(), ...input }],
      skipDuplicates: true,
    });
    const row = await this.prisma.patronCreditEntry.findUniqueOrThrow({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (
      row.userId !== input.userId ||
      row.amountCredits !== input.amountCredits ||
      row.kind !== input.kind ||
      row.situationKey !== input.situationKey
    )
      throw new DomainError(
        "INVALID_NAME",
        "Idempotency key was already used for a different Patron credit entry.",
      );
    return { entry: creditEntry(row), created: result.count === 1 };
  }

  async creditBalance(userId: string) {
    const result = await this.prisma.patronCreditEntry.aggregate({
      where: { userId },
      _sum: { amountCredits: true },
    });
    return result._sum.amountCredits ?? 0n;
  }

  async listCreditEntries(userId: string, limit: number) {
    return (
      await this.prisma.patronCreditEntry.findMany({
        where: { userId },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: Math.min(Math.max(limit, 1), 100),
      })
    ).map(creditEntry);
  }

  async listProfiles(input: Parameters<PatronRepository["listProfiles"]>[0]) {
    return (
      await this.prisma.patronUserProfile.findMany({
        where: {
          ...(input.tier ? { tier: input.tier } : {}),
          ...(input.search
            ? {
                user: {
                  OR: [
                    {
                      name: {
                        contains: input.search,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      email: {
                        contains: input.search,
                        mode: "insensitive" as const,
                      },
                    },
                  ],
                },
              }
            : {}),
          ...(input.cursor ? { userId: { gt: input.cursor } } : {}),
        },
        orderBy: { userId: "asc" },
        take: input.limit + 1,
      })
    ).map(profile);
  }
}

function configurationData(config: PatronConfiguration) {
  return {
    version: config.version,
    creditMicrousd: config.creditMicrousd,
    flatMode: config.flatMode,
    budgetPeriod: config.budget.period,
    ceilingCredits: config.budget.ceilingCredits,
    safetyBufferBps: config.budget.safetyBufferBps,
    promoReserveBps: config.budget.promoReserveBps,
    poolShares: json(config.budget.poolShares),
    scoringWeights: json(config.scoring.weights),
    halfLifeDays: config.scoring.halfLifeDays,
    tierBands: json(config.scoring.tierBands),
    demotionGraceDays: config.scoring.demotionGraceDays,
    monthlyAllowances: json(stringifyBigintRecord(config.monthlyAllowances)),
    taskClasses: json(stringifyTaskClasses(config.taskClasses)),
    planFloors: json(config.planFloors),
    updatedAt: config.updatedAt,
  };
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function configuration(row: {
  key: string;
  version: number;
  creditMicrousd: number;
  flatMode: boolean;
  budgetPeriod: string;
  ceilingCredits: bigint;
  safetyBufferBps: number;
  promoReserveBps: number;
  poolShares: unknown;
  scoringWeights: unknown;
  halfLifeDays: number;
  tierBands: unknown;
  demotionGraceDays: number;
  monthlyAllowances: unknown;
  taskClasses: unknown;
  planFloors: unknown;
  updatedAt: Date;
}): PatronConfiguration {
  return {
    key: row.key,
    version: row.version,
    creditMicrousd: row.creditMicrousd,
    flatMode: row.flatMode,
    budget: {
      period: "monthly",
      ceilingCredits: row.ceilingCredits,
      safetyBufferBps: row.safetyBufferBps,
      promoReserveBps: row.promoReserveBps,
      poolShares: row.poolShares as Record<PatronTier, number>,
    },
    scoring: {
      weights: row.scoringWeights as PatronConfiguration["scoring"]["weights"],
      halfLifeDays: row.halfLifeDays,
      tierBands: row.tierBands as Record<
        PatronTier,
        { min: number; max: number }
      >,
      demotionGraceDays: row.demotionGraceDays,
    },
    monthlyAllowances: parseBigintRecord(row.monthlyAllowances),
    taskClasses: parseTaskClasses(row.taskClasses),
    planFloors: row.planFloors as Record<string, PatronTier>,
    updatedAt: row.updatedAt,
  };
}

function budgetPeriod(row: {
  periodKey: string;
  pressure: string;
  spentCredits: bigint;
  plannedCredits: bigint;
  forecastCredits: bigint;
  poolBalances: unknown;
  updatedAt: Date;
}): PatronBudgetPeriod {
  return {
    periodKey: row.periodKey,
    pressure: row.pressure as BudgetPressure,
    spentCredits: row.spentCredits,
    plannedCredits: row.plannedCredits,
    forecastCredits: row.forecastCredits,
    poolBalances: parseBigintRecord(row.poolBalances),
    updatedAt: row.updatedAt,
  };
}

function actionCreditRule(row: {
  key: string;
  description: string;
  creditDelta: bigint;
  guide: string;
  active: boolean;
  updatedAt: Date;
}): PatronActionCreditRule {
  return row;
}

function profile(row: {
  userId: string;
  valueScore: number;
  potentialScore: number;
  tier: string;
  provisional: boolean;
  periodStart: Date;
  periodEnd: Date;
  allowanceRemainingCredits: bigint;
  updatedAt: Date;
}): PatronUserProfile {
  return { ...row, tier: row.tier as PatronTier };
}

function creditEntry(row: {
  id: string;
  userId: string;
  amountCredits: bigint;
  kind: string;
  situationKey: string | null;
  description: string;
  idempotencyKey: string;
  occurredAt: Date;
}): PatronCreditEntry {
  return { ...row, kind: row.kind as CreditEntryKind };
}

function stringifyBigintRecord<T extends string>(
  value: Record<T, bigint>,
): Record<T, string> {
  return Object.fromEntries(
    Object.entries(value).map(([key, amount]) => [key, String(amount)]),
  ) as Record<T, string>;
}

function parseBigintRecord<T extends string>(
  value: unknown,
): Record<T, bigint> {
  const object = value as JsonRecord;
  return Object.fromEntries(
    Object.entries(object).map(([key, amount]) => [
      key,
      BigInt(String(amount)),
    ]),
  ) as Record<T, bigint>;
}

function stringifyTaskClasses(
  value: Record<string, TaskClassConfiguration>,
): Record<string, JsonRecord> {
  return Object.fromEntries(
    Object.entries(value).map(([key, task]) => [
      key,
      { ...task, estimatedCredits: String(task.estimatedCredits) },
    ]),
  );
}

function parseTaskClasses(
  value: unknown,
): Record<string, TaskClassConfiguration> {
  return Object.fromEntries(
    Object.entries(value as JsonRecord).map(([key, raw]) => {
      const task = raw as JsonRecord;
      return [
        key,
        {
          qualitySensitivity:
            task.qualitySensitivity as TaskClassConfiguration["qualitySensitivity"],
          estimatedCredits: BigInt(String(task.estimatedCredits)),
          maxInputTokens: Number(task.maxInputTokens),
          maxOutputTokens: Number(task.maxOutputTokens),
        },
      ];
    }),
  );
}
