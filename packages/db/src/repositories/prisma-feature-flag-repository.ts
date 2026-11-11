import type {
  FeatureFlagRepository,
  FeatureFlagUserOverride,
  FlagDefinition,
} from "@edu-service/feature-flags";
import { Prisma, type PrismaClient } from "../generated/client.js";

type Client = Pick<PrismaClient, "featureFlag" | "featureFlagUserOverride">;

export class PrismaFeatureFlagRepository implements FeatureFlagRepository {
  constructor(private readonly prisma: Client) {}

  async list(): Promise<readonly FlagDefinition[]> {
    const rows = await this.prisma.featureFlag.findMany({
      orderBy: { key: "asc" },
    });
    return rows.map((row) => fromRow(row.definition, row.enabled));
  }

  async find(key: string): Promise<FlagDefinition | null> {
    const row = await this.prisma.featureFlag.findUnique({ where: { key } });
    return row ? fromRow(row.definition, row.enabled) : null;
  }

  async save(flag: FlagDefinition): Promise<FlagDefinition> {
    const definition = flag as unknown as Prisma.InputJsonValue;
    const row = await this.prisma.featureFlag.upsert({
      where: { key: flag.key },
      create: { key: flag.key, definition, enabled: flag.enabled },
      update: { definition, enabled: flag.enabled },
    });
    return fromRow(row.definition, row.enabled);
  }

  async delete(key: string): Promise<boolean> {
    return (
      (await this.prisma.featureFlag.deleteMany({ where: { key } })).count > 0
    );
  }

  async findOverride(
    key: string,
    userId: string,
  ): Promise<FeatureFlagUserOverride | null> {
    const row = await this.prisma.featureFlagUserOverride.findUnique({
      where: { flagKey_userId: { flagKey: key, userId } },
    });
    return (
      row && {
        flagKey: row.flagKey,
        userId: row.userId,
        enabled: row.enabled,
        variantKey: row.variantKey,
      }
    );
  }

  async saveOverride(
    value: FeatureFlagUserOverride,
  ): Promise<FeatureFlagUserOverride> {
    const row = await this.prisma.featureFlagUserOverride.upsert({
      where: {
        flagKey_userId: { flagKey: value.flagKey, userId: value.userId },
      },
      create: value,
      update: { enabled: value.enabled, variantKey: value.variantKey },
    });
    return {
      flagKey: row.flagKey,
      userId: row.userId,
      enabled: row.enabled,
      variantKey: row.variantKey,
    };
  }

  async deleteOverride(key: string, userId: string): Promise<boolean> {
    return (
      (
        await this.prisma.featureFlagUserOverride.deleteMany({
          where: { flagKey: key, userId },
        })
      ).count > 0
    );
  }
}

function fromRow(value: Prisma.JsonValue, enabled: boolean): FlagDefinition {
  return { ...(value as unknown as FlagDefinition), enabled };
}
