import { describe, expect, it, vi } from "vitest";
import {
  createAiService,
  type AiModel,
  type AiProvider,
  type ModelCatalogRepository,
} from "../src/index.js";

const now = new Date("2026-10-30T00:00:00Z");
function model(overrides: Partial<AiModel> = {}): AiModel {
  return {
    id: "primary",
    provider: "openai",
    providerModelId: "gpt",
    displayName: "GPT",
    tier: "balanced",
    capabilities: ["chat"],
    inputPriceMicrousdPerMillionTokens: 1,
    outputPriceMicrousdPerMillionTokens: 1,
    deprecatesAt: null,
    fallbackModelIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
function repository(models: AiModel[]): ModelCatalogRepository {
  return {
    save: async (value) => value,
    findById: async (id) => models.find((item) => item.id === id) ?? null,
    list: async () => models,
  };
}

describe("AI service routing", () => {
  it("uses an adjacent compatible fallback after a provider failure and records bounded telemetry", async () => {
    const fallback = model({
      id: "fallback",
      provider: "anthropic",
      providerModelId: "claude",
    });
    const primary = model({ fallbackModelIds: [fallback.id] });
    const log = { info: vi.fn(), error: vi.fn() };
    const providers: AiProvider[] = [
      {
        id: "openai",
        complete: async () => {
          throw new Error("down");
        },
        generateImage: async () => ({ url: "" }),
      },
      {
        id: "anthropic",
        complete: async () => ({ text: "ok", inputTokens: 1, outputTokens: 1 }),
        generateImage: async () => ({ url: "" }),
      },
    ];
    await expect(
      createAiService({
        models: repository([primary, fallback]),
        providers,
        operationLog: log,
      }).complete(
        "primary",
        { messages: [{ role: "user", content: "sensitive" }] },
        "c1",
      ),
    ).resolves.toMatchObject({ text: "ok" });
    expect(log.error).toHaveBeenCalledWith(
      "ai.request.failed",
      expect.objectContaining({ modelId: "primary" }),
      "c1",
    );
    expect(log.info).toHaveBeenCalledWith(
      "ai.request.succeeded",
      expect.objectContaining({ fallbackUsed: true }),
      "c1",
    );
  });
  it("skips models whose deprecation date has passed", async () => {
    const expired = model({ deprecatesAt: new Date("2026-10-29T00:00:00Z") });
    const provider: AiProvider = {
      id: "openai",
      complete: async () => ({ text: "no" }),
      generateImage: async () => ({ url: "" }),
    };
    await expect(
      createAiService({
        models: repository([expired]),
        providers: [provider],
        clock: () => now,
      }).complete("primary", { messages: [] }),
    ).rejects.toThrow("No active compatible");
  });
  it("routes Jev-style typed decisions only through a configured decision provider", async () => {
    const jev = model({ provider: "jev", capabilities: ["decision"] });
    const provider: AiProvider = {
      id: "jev",
      complete: async () => ({ text: "" }),
      generateImage: async () => ({ url: "" }),
      decide: async () => ({ choice: "approve", confidence: 0.9 }),
    };
    await expect(
      createAiService({
        models: repository([jev]),
        providers: [provider],
      }).decide("primary", {
        state: "request is complete",
        question: "approve?",
        options: ["approve", "reject"],
      }),
    ).resolves.toEqual({ choice: "approve", confidence: 0.9 });
  });

  it("selects the cheapest compatible provider model when Patron constrains spend", async () => {
    const requested = model({
      id: "openai-gpt-4.1-mini",
      tier: "economy",
      inputPriceMicrousdPerMillionTokens: 400_000,
      outputPriceMicrousdPerMillionTokens: 1_600_000,
    });
    const cheaper = model({
      id: "openai-gpt-4o-mini",
      tier: "economy",
      inputPriceMicrousdPerMillionTokens: 150_000,
      outputPriceMicrousdPerMillionTokens: 600_000,
    });
    const provider: AiProvider = {
      id: "openai",
      complete: async () => ({ text: "" }),
      generateImage: async () => ({ url: "" }),
      runAgent: async () => ({
        text: "",
        sources: [],
        toolCalls: [],
        webSearchCalls: 0,
      }),
    };
    const service = createAiService({
      models: repository([requested, cheaper]),
      providers: [provider],
    });

    await expect(
      service.selectModel(requested.id, "economy", {
        preferCheapest: true,
      }),
    ).resolves.toBe(cheaper.id);
    await expect(service.selectModel(requested.id, "economy")).resolves.toBe(
      requested.id,
    );
  });
});
