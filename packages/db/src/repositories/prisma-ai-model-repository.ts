import type {
  AiModel,
  AiProviderId,
  ModelCatalogRepository,
  ModelTier,
  AiCapability,
} from "@life-optimizer/ai";
import type { PrismaClient } from "../generated/client.js";

type AiModelPrisma = Pick<PrismaClient, "aiModel">;
type AiModelRecord = {
  id: string;
  provider: string;
  providerModelId: string;
  displayName: string;
  tier: string;
  capabilities: unknown;
  inputPriceMicrousdPerMillionTokens: number;
  outputPriceMicrousdPerMillionTokens: number;
  deprecatesAt: Date | null;
  fallbackModelIds: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/** Prisma adapter for the provider-neutral catalog port. */
export class PrismaAiModelRepository implements ModelCatalogRepository {
  constructor(private readonly prisma: AiModelPrisma) {}
  async save(model: AiModel): Promise<AiModel> {
    return toDomain(
      await this.prisma.aiModel.upsert({
        where: { id: model.id },
        create: { id: model.id, ...toData(model) },
        update: toData(model),
      }),
    );
  }
  async findById(id: string): Promise<AiModel | null> {
    const model = await this.prisma.aiModel.findUnique({ where: { id } });
    return model ? toDomain(model) : null;
  }
  async list(): Promise<readonly AiModel[]> {
    return (await this.prisma.aiModel.findMany({ orderBy: { id: "asc" } })).map(
      toDomain,
    );
  }
}

function toData(model: AiModel) {
  return {
    provider: model.provider,
    providerModelId: model.providerModelId,
    displayName: model.displayName,
    tier: model.tier,
    capabilities: [...model.capabilities],
    inputPriceMicrousdPerMillionTokens:
      model.inputPriceMicrousdPerMillionTokens,
    outputPriceMicrousdPerMillionTokens:
      model.outputPriceMicrousdPerMillionTokens,
    deprecatesAt: model.deprecatesAt,
    fallbackModelIds: [...model.fallbackModelIds],
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}
function toDomain(model: AiModelRecord): AiModel {
  return {
    id: model.id,
    provider: model.provider as AiProviderId,
    providerModelId: model.providerModelId,
    displayName: model.displayName,
    tier: model.tier as ModelTier,
    capabilities: model.capabilities as AiCapability[],
    inputPriceMicrousdPerMillionTokens:
      model.inputPriceMicrousdPerMillionTokens,
    outputPriceMicrousdPerMillionTokens:
      model.outputPriceMicrousdPerMillionTokens,
    deprecatesAt: model.deprecatesAt,
    fallbackModelIds: model.fallbackModelIds as string[],
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}
