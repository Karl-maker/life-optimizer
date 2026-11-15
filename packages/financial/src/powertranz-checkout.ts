import { createHash, randomUUID } from "node:crypto";
import {
  DomainError,
  type Actor,
  type AuditContext,
  type OperationLog,
} from "@life-optimizer/core";
import type { BillingInvoice, createBillingService } from "./billing.js";
import {
  PowerTranzAdapter,
  PowerTranzAuthenticationError,
  type PowerTranzHostedSession,
} from "./powertranz.js";

export interface PowerTranzPendingSale {
  id: string;
  invoiceId: string;
  userId: string;
  transactionIdentifier: string;
  orderIdentifier: string;
  amountMinor: bigint;
  currency: string;
  tokenHash: string;
  expiresAt: Date;
  threeDSecure: boolean;
  status: "pending" | "processing" | "completed" | "declined";
  processingStartedAt: Date | null;
}
export interface PowerTranzSaleRepository {
  create(sale: PowerTranzPendingSale): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<PowerTranzPendingSale | null>;
  claim(id: string, at: Date): Promise<boolean>;
  setStatus(id: string, status: "completed" | "declined"): Promise<void>;
}
type Billing = ReturnType<typeof createBillingService>;
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export class InvalidPowerTranzCallbackError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("Invalid PowerTranz return.");
    this.name = "InvalidPowerTranzCallbackError";
  }
}

/** A browser callback is only a trigger. The provider's server response decides settlement. */
export function createPowerTranzCheckout(input: {
  adapter: PowerTranzAdapter;
  repository: PowerTranzSaleRepository;
  billing: Pick<
    Billing,
    "bindInvoiceProvider" | "recordPayment" | "recordDunningFailure"
  >;
  findInvoice(id: string): Promise<BillingInvoice | null>;
  findAccountById(id: string): Promise<{ userId: string } | null>;
  agentId: string;
  clock?: () => Date;
  operationLog?: OperationLog;
}) {
  const clock = input.clock ?? (() => new Date());
  return {
    async begin(request: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      invoiceId: string;
      merchantResponseUrl: string;
      threeDSecure: boolean;
    }) {
      const invoice = await input.findInvoice(request.invoiceId);
      const account = invoice
        ? await input.findAccountById(invoice.accountId)
        : null;
      if (
        !invoice ||
        !account ||
        account.userId !== request.userId ||
        request.actor.kind !== "agent" ||
        request.actor.onBehalfOf !== request.userId ||
        !request.actor.permissions.includes("financial:manage") ||
        invoice.status !== "open" ||
        invoice.totalMinor <= 0n ||
        invoice.provider !== null
      )
        throw new DomainError(
          "INVALID_NAME",
          "An owned, unbound payable invoice is required.",
        );
      const transactionIdentifier = randomUUID();
      const session = await input.adapter.beginHostedSale({
        transactionIdentifier,
        orderIdentifier: invoice.id,
        amount: { currency: invoice.currency, amountMinor: invoice.totalMinor },
        merchantResponseUrl: request.merchantResponseUrl,
        threeDSecure: request.threeDSecure,
      });
      await input.billing.bindInvoiceProvider({
        actor: request.actor,
        audit: request.audit,
        userId: request.userId,
        invoiceId: invoice.id,
        provider: "powertranz",
        providerReference: transactionIdentifier,
      });
      await input.repository.create({
        id: randomUUID(),
        invoiceId: invoice.id,
        userId: request.userId,
        transactionIdentifier,
        orderIdentifier: invoice.id,
        amountMinor: invoice.totalMinor,
        currency: invoice.currency,
        tokenHash: tokenHash(session.spiToken),
        expiresAt: session.expiresAt,
        threeDSecure: session.threeDSecure,
        status: "pending",
        processingStartedAt: null,
      });
      return {
        transactionIdentifier,
        redirectData: session.redirectData,
        expiresAt: session.expiresAt,
      };
    },
    async complete(request: {
      audit: AuditContext;
      browserResult: unknown;
    }): Promise<{ status: "completed" | "declined" | "processing" }> {
      if (
        !request.browserResult ||
        typeof request.browserResult !== "object" ||
        Array.isArray(request.browserResult)
      )
        throw new InvalidPowerTranzCallbackError();
      const callback = request.browserResult as Record<string, unknown>;
      if (
        typeof callback.SpiToken !== "string" ||
        callback.SpiToken.length < 4 ||
        callback.SpiToken.length > 512
      )
        throw new InvalidPowerTranzCallbackError();
      const sale = await input.repository.findByTokenHash(
        tokenHash(callback.SpiToken),
      );
      if (!sale) throw new InvalidPowerTranzCallbackError();
      const actor: Actor = {
        kind: "agent",
        agentId: input.agentId,
        onBehalfOf: sale.userId,
        permissions: ["financial:manage"],
      };
      if (sale.status === "completed") return { status: "completed" };
      if (sale.status === "declined") return { status: "declined" };
      const now = clock();
      if (sale.status === "processing") {
        if (
          !sale.processingStartedAt ||
          now.getTime() - sale.processingStartedAt.getTime() < 120_000
        )
          return { status: "processing" };
        if (
          !(await input.adapter.queryApprovedSale({
            transactionIdentifier: sale.transactionIdentifier,
            amount: { currency: sale.currency, amountMinor: sale.amountMinor },
          }))
        )
          return { status: "processing" };
        await input.billing.recordPayment({
          actor,
          audit: request.audit,
          userId: sale.userId,
          invoiceId: sale.invoiceId,
          provider: "powertranz",
          providerReference: sale.transactionIdentifier,
          amountMinor: sale.amountMinor,
          currency: sale.currency,
          occurredAt: now,
        });
        await input.repository.setStatus(sale.id, "completed");
        return { status: "completed" };
      }
      if (now >= sale.expiresAt) throw new InvalidPowerTranzCallbackError();
      if (!(await input.repository.claim(sale.id, now)))
        return { status: "processing" };
      const session: PowerTranzHostedSession = {
        transactionIdentifier: sale.transactionIdentifier,
        orderIdentifier: sale.orderIdentifier,
        amount: { currency: sale.currency, amountMinor: sale.amountMinor },
        spiToken: callback.SpiToken,
        expiresAt: sale.expiresAt,
        redirectData: "",
        threeDSecure: sale.threeDSecure,
      };
      try {
        const result = await input.adapter.completeHostedSale({
          session,
          browserResult: callback,
        });
        if (result.approved) {
          await input.billing.recordPayment({
            actor,
            audit: request.audit,
            userId: sale.userId,
            invoiceId: sale.invoiceId,
            provider: "powertranz",
            providerReference: result.transactionIdentifier,
            amountMinor: sale.amountMinor,
            currency: sale.currency,
            occurredAt: now,
          });
          await input.repository.setStatus(sale.id, "completed");
          return { status: "completed" };
        }
        await input.billing.recordDunningFailure({
          actor,
          audit: request.audit,
          userId: sale.userId,
          invoiceId: sale.invoiceId,
          providerEventId: sale.transactionIdentifier,
          failureCategory: "payment_declined",
          providerFailureCode: result.isoResponseCode,
          requiresCustomerAction: true,
          schedule: { delaysSeconds: [], graceSeconds: 0 },
        });
        await input.repository.setStatus(sale.id, "declined");
        return { status: "declined" };
      } catch (error) {
        if (error instanceof PowerTranzAuthenticationError) {
          await input.billing.recordDunningFailure({
            actor,
            audit: request.audit,
            userId: sale.userId,
            invoiceId: sale.invoiceId,
            providerEventId: sale.transactionIdentifier,
            failureCategory: "authentication_failed",
            requiresCustomerAction: true,
            schedule: { delaysSeconds: [], graceSeconds: 0 },
          });
          await input.repository.setStatus(sale.id, "declined");
          return { status: "declined" };
        }
        input.operationLog?.error(
          "financial.powertranz.callback.failed",
          { transactionIdentifier: sale.transactionIdentifier },
          request.audit.correlationId,
        );
        throw error;
      }
    },
  };
}
