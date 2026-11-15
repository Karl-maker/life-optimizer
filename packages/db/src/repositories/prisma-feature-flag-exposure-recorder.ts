import type {
  ExposureRecord,
  ExposureRecorder,
} from "@life-optimizer/feature-flags";
import type { PrismaClient } from "../generated/client.js";

export class PrismaFeatureFlagExposureRecorder implements ExposureRecorder {
  constructor(
    private readonly prisma: Pick<PrismaClient, "featureFlagExposure">,
  ) {}
  async record(value: ExposureRecord): Promise<void> {
    await this.prisma.featureFlagExposure.upsert({
      where: { evaluationId: value.evaluationId },
      create: {
        evaluationId: value.evaluationId,
        flagKey: value.flagKey,
        flagVersion: value.flagVersion,
        targetingKey: value.targetingKey,
        variant: value.variant,
        reason: value.reason,
        matchedRuleId: value.matchedRuleId ?? null,
        bucket: value.bucket ?? null,
        assignmentId: value.assignmentId,
        correlationId: value.correlationId ?? null,
        occurredAt: value.occurredAt,
      },
      update: {},
    });
  }
}
