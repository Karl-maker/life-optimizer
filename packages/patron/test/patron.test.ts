import { describe, expect, it, vi } from "vitest";
import type { AuditLog, EventOutbox } from "@edu-service/core";
import {
  createPatronService,
  defaultPatronConfiguration,
  type PatronActionCreditRule,
  type PatronBudgetPeriod,
  type PatronConfiguration,
  type PatronCreditEntry,
  type PatronRepository,
  type PatronTransactionRunner,
  type PatronUserProfile,
} from "../src/index.js";

const now = new Date("2026-11-01T10:00:00Z");
const actor = { kind: "user" as const, userId: "user-1" };
const manager = {
  kind: "agent" as const,
  agentId: "finance-admin",
  onBehalfOf: "user-1",
  permissions: ["financial:manage" as const],
};
const audit = { correlationId: "patron-test", source: "api" as const };

function setup() {
  let config: PatronConfiguration | null = defaultPatronConfiguration(now);
  let budget: PatronBudgetPeriod | null = null;
  let profile: PatronUserProfile | null = null;
  const rules = new Map<string, PatronActionCreditRule>();
  const credits: PatronCreditEntry[] = [];
  const outbox: unknown[] = [];
  const auditLog: AuditLog = { append: vi.fn(async () => undefined) };
  const repository: PatronRepository = {
    getConfiguration: async () => config,
    saveConfiguration: async (value) => ((config = value), value),
    getBudgetPeriod: async () => budget,
    saveBudgetPeriod: async (value) => ((budget = value), value),
    findActionCreditRule: async (key) => rules.get(key) ?? null,
    saveActionCreditRule: async (value) => (rules.set(value.key, value), value),
    getProfile: async () => profile,
    saveProfile: async (value) => ((profile = value), value),
    addCreditEntry: async (input) => {
      const existing = credits.find(
        (entry) => entry.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return { entry: existing, created: false };
      const entry = { ...input, id: `credit-${credits.length + 1}` };
      credits.push(entry);
      return { entry, created: true };
    },
    creditBalance: async (userId) =>
      credits
        .filter((entry) => entry.userId === userId)
        .reduce((sum, entry) => sum + entry.amountCredits, 0n),
    listCreditEntries: async () => [...credits].reverse(),
  };
  const events: EventOutbox = {
    append: async (event) => {
      outbox.push(event);
    },
  };
  const transactions: PatronTransactionRunner = {
    run: (work) => work({ patron: repository, audit: auditLog, events }),
  };
  return {
    service: createPatronService({
      repository,
      transactions,
      clock: () => now,
    }),
    auditLog,
    outbox,
    rules,
    setBudget(value: PatronBudgetPeriod) {
      budget = value;
    },
  };
}

describe("Patron credits", () => {
  it("rejects percentage settings that do not total 100 percent", async () => {
    const t = setup();
    const config = defaultPatronConfiguration(now);
    await expect(
      t.service.configure({
        actor: manager,
        audit,
        config: {
          ...config,
          budget: {
            ...config.budget,
            poolShares: { T0: 0.25, T1: 0.25, T2: 0.25, T3: 0.1 },
          },
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
    await expect(
      t.service.configure({
        actor: manager,
        audit,
        config: {
          ...config,
          scoring: {
            ...config.scoring,
            weights: {
              ...config.scoring.weights,
              revenue: 0.5,
            },
          },
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
  });

  it("stores configurable situations and applies them idempotently", async () => {
    const t = setup();
    await t.service.configureActionCredit({
      actor: manager,
      audit,
      key: "commented",
      description: "Quality comment accepted",
      creditDelta: 3n,
      guide: "Use when a non-spam comment adds value to a lesson discussion.",
    });
    const entry = await t.service.applyCreditSituation({
      actor,
      audit,
      userId: "user-1",
      situationKey: "commented",
      idempotencyKey: "comment-1",
    });
    expect(entry.amountCredits).toBe(3n);
    await t.service.applyCreditSituation({
      actor,
      audit,
      userId: "user-1",
      situationKey: "commented",
      idempotencyKey: "comment-1",
    });
    await expect(t.service.explain("user-1")).resolves.toMatchObject({
      creditBalance: 3n,
    });
    expect(t.auditLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "patron.action_credit.configured",
        resource: { type: "patron-action-credit", id: "commented" },
      }),
    );
    expect(t.outbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "patron.credits.added" }),
      ]),
    );
  });

  it("lets finance add and subtract credits with bounded audit payloads", async () => {
    const t = setup();
    await t.service.addCredits({
      actor: manager,
      audit,
      userId: "user-1",
      amountCredits: 10n,
      description: "Manual goodwill grant",
      idempotencyKey: "grant-1",
    });
    await t.service.subtractCredits({
      actor: manager,
      audit,
      userId: "user-1",
      amountCredits: 4n,
      description: "Manual correction",
      idempotencyKey: "subtract-1",
    });
    await expect(t.service.explain("user-1")).resolves.toMatchObject({
      creditBalance: 6n,
    });
    expect(t.auditLog.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "patron.credits.subtracted" }),
    );
  });
});

describe("Patron decisions", () => {
  it("uses stored budget pressure to degrade lower-value usage first", async () => {
    const t = setup();
    t.setBudget({
      periodKey: "2026-11",
      pressure: "orange",
      spentCredits: 80n,
      plannedCredits: 70n,
      forecastCredits: 120n,
      poolBalances: { T0: 10n, T1: 10n, T2: 10n, T3: 10n },
      updatedAt: now,
    });
    await expect(
      t.service.decide("user-1", { taskClass: "final_answer" }),
    ).resolves.toMatchObject({
      tier: "T1",
      modelClass: "economy",
      reasonCode: "budget_pressure_degrade",
      budgetPressure: "orange",
    });
  });
});
