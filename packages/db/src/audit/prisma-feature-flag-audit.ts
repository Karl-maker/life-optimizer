import type { FeatureFlagChangeAudit } from "@life-optimizer/feature-flags";
import {
  AuditActorKind,
  AuditOutcome,
  type PrismaClient,
} from "../generated/client.js";

export class PrismaFeatureFlagAudit implements FeatureFlagChangeAudit {
  constructor(private readonly prisma: Pick<PrismaClient, "auditEvent">) {}

  async record(
    input: Parameters<FeatureFlagChangeAudit["record"]>[0],
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        occurredAt: new Date(),
        companyId: null,
        actorKind: AuditActorKind.USER,
        actorId: input.actorId,
        onBehalfOfId: null,
        action: `feature_flag.${input.action}`,
        outcome: AuditOutcome.SUCCEEDED,
        resourceType: "feature-flag",
        resourceId: input.flagKey,
        correlationId: input.correlationId,
        source: "api",
        actorSource: null,
        ...(input.userId ? { changes: { targetUserId: input.userId } } : {}),
      },
    });
  }
}
