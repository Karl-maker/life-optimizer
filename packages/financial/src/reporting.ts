import { DomainError, type Actor } from "@edu-service/core";

export interface CatalogPriceView {
  id: string;
  currency: string;
  unitAmountMinor: bigint;
  frequency: string;
  intervalCount: number;
  trialDays: number;
}

export interface CatalogProductView {
  id: string;
  key: string;
  name: string;
  createdAt: Date;
  prices: readonly CatalogPriceView[];
}

export interface PaymentHistoryView {
  id: string;
  invoiceId: string;
  provider: string;
  amountMinor: bigint;
  currency: string;
  status: string;
  occurredAt: Date;
  refundedAmountMinor: bigint;
}

export interface RevenueSummary {
  currency: string;
  grossAmountMinor: bigint;
  refundedAmountMinor: bigint;
  netAmountMinor: bigint;
  paymentCount: number;
  refundCount: number;
  byProvider: readonly {
    provider: string;
    grossAmountMinor: bigint;
    paymentCount: number;
  }[];
}

export interface FinancialReportingRepository {
  findCatalogProduct(id: string): Promise<CatalogProductView | null>;
  listCatalog(input: {
    limit: number;
    cursor?: { createdAt: Date; id: string };
    currency?: string;
  }): Promise<readonly CatalogProductView[]>;
  listUserPayments(input: {
    userId: string;
    limit: number;
    cursor?: { occurredAt: Date; id: string };
    provider?: string;
    status?: string;
    currency?: string;
  }): Promise<readonly PaymentHistoryView[]>;
  revenueSummary(input: {
    from?: Date;
    to?: Date;
    provider?: string;
    status?: string;
    currency?: string;
  }): Promise<readonly RevenueSummary[]>;
}

export interface FinancialViewer {
  actor: Actor;
  permissions: readonly string[];
}

export function createFinancialReportingService(
  repository: FinancialReportingRepository,
) {
  return {
    getCatalogProduct(id: string) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          id,
        )
      )
        throw new DomainError("INVALID_NAME", "Product ID must be a UUID.");
      return repository.findCatalogProduct(id);
    },
    listCatalog(input: {
      limit: number;
      cursor?: { createdAt: Date; id: string };
      currency?: string;
    }) {
      boundedLimit(input.limit);
      if (input.currency !== undefined) currency(input.currency);
      return repository.listCatalog(input);
    },
    listPaymentHistory(
      viewer: FinancialViewer,
      input: {
        userId: string;
        limit: number;
        cursor?: { occurredAt: Date; id: string };
        provider?: string;
        status?: string;
        currency?: string;
      },
    ) {
      boundedLimit(input.limit);
      const subject =
        viewer.actor.kind === "user"
          ? viewer.actor.userId
          : viewer.actor.onBehalfOf;
      if (
        subject !== input.userId &&
        !viewer.permissions.includes("payments:read")
      )
        throw new DomainError(
          "FORBIDDEN",
          "Payment history is limited to its owner or a payment administrator.",
        );
      if (input.currency !== undefined) currency(input.currency);
      return repository.listUserPayments(input);
    },
    revenueSummary(
      viewer: FinancialViewer,
      input: {
        from?: Date;
        to?: Date;
        provider?: string;
        status?: string;
        currency?: string;
      },
    ) {
      if (!viewer.permissions.includes("finance:read"))
        throw new DomainError(
          "FORBIDDEN",
          "Permission finance:read is required.",
        );
      if (input.from && input.to && input.from >= input.to)
        throw new DomainError(
          "INVALID_NAME",
          "Revenue start must be before end.",
        );
      if (input.currency !== undefined) currency(input.currency);
      return repository.revenueSummary(input);
    },
  };
}

export type FinancialReportingService = ReturnType<
  typeof createFinancialReportingService
>;

function boundedLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100)
    throw new DomainError("INVALID_NAME", "Limit must be between 1 and 100.");
}

function currency(value: string): void {
  if (!/^[A-Z]{3}$/.test(value))
    throw new DomainError(
      "INVALID_NAME",
      "Currency must be uppercase ISO 4217.",
    );
}
