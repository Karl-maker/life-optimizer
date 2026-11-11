import type {
  FinancialReportingRepository,
  RevenueSummary,
} from "@edu-service/financial";
import type { PrismaClient } from "../generated/client.js";

type Client = Pick<PrismaClient, "product" | "paymentRecord" | "refundRecord">;

export class PrismaFinancialReportingRepository implements FinancialReportingRepository {
  constructor(private readonly prisma: Client) {}

  async listCatalog(
    input: Parameters<FinancialReportingRepository["listCatalog"]>[0],
  ) {
    return this.prisma.product.findMany({
      where: {
        active: true,
        riskLevel: { not: "blocked" },
        prices: {
          some: {
            active: true,
            ...(input.currency === undefined
              ? {}
              : { currency: input.currency }),
          },
        },
      },
      take: input.limit + 1,
      ...(input.cursor === undefined
        ? {}
        : { cursor: { id: input.cursor.id }, skip: 1 }),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        createdAt: true,
        prices: {
          where: {
            active: true,
            ...(input.currency === undefined
              ? {}
              : { currency: input.currency }),
          },
          orderBy: [{ currency: "asc" }, { unitAmountMinor: "asc" }],
          select: {
            id: true,
            currency: true,
            unitAmountMinor: true,
            frequency: true,
            intervalCount: true,
            trialDays: true,
          },
        },
      },
    });
  }

  async listUserPayments(
    input: Parameters<FinancialReportingRepository["listUserPayments"]>[0],
  ) {
    const rows = await this.prisma.paymentRecord.findMany({
      where: {
        invoice: { account: { userId: input.userId } },
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.currency === undefined ? {} : { currency: input.currency }),
      },
      take: input.limit + 1,
      ...(input.cursor === undefined
        ? {}
        : { cursor: { id: input.cursor.id }, skip: 1 }),
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      include: {
        refunds: {
          where: { status: "succeeded" },
          select: { amountMinor: true },
        },
      },
    });
    return rows.map(({ refunds, ...row }) => ({
      ...row,
      refundedAmountMinor: refunds.reduce(
        (sum, refund) => sum + refund.amountMinor,
        0n,
      ),
    }));
  }

  async revenueSummary(
    input: Parameters<FinancialReportingRepository["revenueSummary"]>[0],
  ) {
    const paymentWhere = {
      ...(input.from === undefined && input.to === undefined
        ? {}
        : {
            occurredAt: {
              ...(input.from === undefined ? {} : { gte: input.from }),
              ...(input.to === undefined ? {} : { lt: input.to }),
            },
          }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.status === undefined
        ? { status: "succeeded" }
        : { status: input.status }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
    };
    const payments = await this.prisma.paymentRecord.findMany({
      where: paymentWhere,
      select: { id: true, provider: true, currency: true, amountMinor: true },
    });
    const paymentIds = payments.map((payment) => payment.id);
    const refunds =
      paymentIds.length === 0
        ? []
        : await this.prisma.refundRecord.findMany({
            where: { paymentId: { in: paymentIds }, status: "succeeded" },
            select: {
              paymentId: true,
              amountMinor: true,
              payment: { select: { currency: true } },
            },
          });
    const byCurrency = new Map<string, RevenueSummary>();
    for (const payment of payments) {
      const current = byCurrency.get(payment.currency) ?? {
        currency: payment.currency,
        grossAmountMinor: 0n,
        refundedAmountMinor: 0n,
        netAmountMinor: 0n,
        paymentCount: 0,
        refundCount: 0,
        byProvider: [],
      };
      const providers = new Map(
        current.byProvider.map((value) => [value.provider, value]),
      );
      const provider = providers.get(payment.provider) ?? {
        provider: payment.provider,
        grossAmountMinor: 0n,
        paymentCount: 0,
      };
      providers.set(payment.provider, {
        ...provider,
        grossAmountMinor: provider.grossAmountMinor + payment.amountMinor,
        paymentCount: provider.paymentCount + 1,
      });
      byCurrency.set(payment.currency, {
        ...current,
        grossAmountMinor: current.grossAmountMinor + payment.amountMinor,
        netAmountMinor: current.netAmountMinor + payment.amountMinor,
        paymentCount: current.paymentCount + 1,
        byProvider: [...providers.values()].sort((a, b) =>
          a.provider.localeCompare(b.provider),
        ),
      });
    }
    for (const refund of refunds) {
      const current = byCurrency.get(refund.payment.currency);
      if (!current) continue;
      byCurrency.set(current.currency, {
        ...current,
        refundedAmountMinor: current.refundedAmountMinor + refund.amountMinor,
        netAmountMinor: current.netAmountMinor - refund.amountMinor,
        refundCount: current.refundCount + 1,
      });
    }
    return [...byCurrency.values()].sort((a, b) =>
      a.currency.localeCompare(b.currency),
    );
  }
}
