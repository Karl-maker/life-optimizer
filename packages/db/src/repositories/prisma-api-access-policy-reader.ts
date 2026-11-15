import type {
  ApiAccessDecision,
  ApiAccessPolicyReader,
} from "@life-optimizer/core";
import { ApiAccessEffect, type PrismaClient } from "../generated/client.js";

type ApiAccessPolicyPrisma = Pick<PrismaClient, "apiAccessPolicy">;

/** PostgreSQL policy reader. Denies take precedence to make emergency blocks reliable. */
export class PrismaApiAccessPolicyReader implements ApiAccessPolicyReader {
  constructor(private readonly prisma: ApiAccessPolicyPrisma) {}

  async evaluate(input: {
    principalId: string;
    endpoint: string;
    at: Date;
  }): Promise<ApiAccessDecision> {
    const policies = await this.prisma.apiAccessPolicy.findMany({
      where: {
        principalId: input.principalId,
        endpoint: { in: [input.endpoint, "*"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: input.at } }],
      },
      select: { effect: true, supportReference: true },
      orderBy: { createdAt: "desc" },
    });
    const denial = policies.find(
      (policy) => policy.effect === ApiAccessEffect.DENY,
    );
    if (denial)
      return {
        outcome: "blocked",
        ...(denial.supportReference === null
          ? {}
          : { supportReference: denial.supportReference }),
      };
    return policies.some((policy) => policy.effect === ApiAccessEffect.ALLOW)
      ? { outcome: "allowed" }
      : { outcome: "not-configured" };
  }
}
