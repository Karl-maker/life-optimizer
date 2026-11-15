import { describe, expect, it, vi } from "vitest";
import type { AuditLog } from "@life-optimizer/core";
import type {
  AiCatalogTransactionRunner,
  AiModel,
  ModelCatalogRepository,
} from "../src/index.js";
import { createAiCatalog } from "../src/index.js";

const now = new Date("2026-10-30T00:00:00Z");
function model(
  overrides: Partial<Omit<AiModel, "createdAt" | "updatedAt">> = {},
): Omit<AiModel, "createdAt" | "updatedAt"> {
  return {
    id: "openai-balanced",
    provider: "openai",
    providerModelId: "gpt",
    displayName: "GPT",
    tier: "balanced",
    capabilities: ["chat"],
    inputPriceMicrousdPerMillionTokens: 1,
    outputPriceMicrousdPerMillionTokens: 2,
    deprecatesAt: null,
    fallbackModelIds: [],
    ...overrides,
  };
}

describe("AI model catalog", () => {
  it("persists registration and its audit event through one transaction", async () => {
    const values: AiModel[] = [];
    const audit: AuditLog = { append: vi.fn(async () => undefined) };
    const models: ModelCatalogRepository = {
      save: async (value) => {
        values.push(value);
        return value;
      },
      findById: async () => null,
      list: async () => values,
    };
    const transactions: AiCatalogTransactionRunner = {
      run: (work) => work({ models, audit }),
    };
    await createAiCatalog({ models, transactions, clock: () => now }).register({
      actor: { kind: "user", userId: "user-1" },
      audit: { correlationId: "c1", source: "job" },
      model: model(),
    });
    expect(values).toHaveLength(1);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.model.registered",
        resource: { type: "ai-model", id: "openai-balanced" },
      }),
    );
  });
  it("reports only models deprecated at the supplied boundary", async () => {
    const expired = {
      ...model({ id: "expired", deprecatesAt: now }),
      createdAt: now,
      updatedAt: now,
    };
    const active = {
      ...model({
        id: "active",
        deprecatesAt: new Date("2026-10-30T00:00:00.001Z"),
      }),
      createdAt: now,
      updatedAt: now,
    };
    const models: ModelCatalogRepository = {
      save: async (value) => value,
      findById: async () => null,
      list: async () => [expired, active],
    };
    const transactions: AiCatalogTransactionRunner = {
      run: async () => {
        throw new Error("not used");
      },
    };
    await expect(
      createAiCatalog({
        models,
        transactions,
        clock: () => now,
      }).checkDeprecations(),
    ).resolves.toEqual([expired]);
  });
});
