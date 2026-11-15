import {
  DomainError,
  type AdminDataRepository,
  type AdminFilter,
} from "@life-optimizer/core";
import { Prisma, type PrismaClient } from "../generated/client.js";

type Delegate = {
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
};
type Resource = { delegate: string; model: string; key: readonly string[] };

const RESOURCES: Record<string, Resource> = {
  users: { delegate: "user", model: "User", key: ["id"] },
  "oauth-identities": {
    delegate: "oAuthIdentity",
    model: "OAuthIdentity",
    key: ["provider", "subject"],
  },
  "password-credentials": {
    delegate: "passwordCredential",
    model: "PasswordCredential",
    key: ["userId"],
  },
  "auth-sessions": {
    delegate: "authSessionRecord",
    model: "AuthSessionRecord",
    key: ["id"],
  },
  "auth-challenges": {
    delegate: "authChallengeRecord",
    model: "AuthChallengeRecord",
    key: ["id"],
  },
  "login-audits": { delegate: "loginAudit", model: "LoginAudit", key: ["id"] },
  "user-devices": {
    delegate: "userDevice",
    model: "UserDevice",
    key: ["userId", "deviceId"],
  },
  "consent-receipts": {
    delegate: "consentReceipt",
    model: "ConsentReceipt",
    key: ["id"],
  },
  "financial-accounts": {
    delegate: "financialAccount",
    model: "FinancialAccount",
    key: ["id"],
  },
  "financial-account-keys": {
    delegate: "financialAccountKey",
    model: "FinancialAccountKey",
    key: ["id"],
  },
  "entitlement-definitions": {
    delegate: "entitlementDefinition",
    model: "EntitlementDefinition",
    key: ["key"],
  },
  products: { delegate: "product", model: "Product", key: ["id"] },
  "product-add-ons": {
    delegate: "productAddOn",
    model: "ProductAddOn",
    key: ["id"],
  },
  prices: { delegate: "price", model: "Price", key: ["id"] },
  "price-entitlements": {
    delegate: "priceEntitlement",
    model: "PriceEntitlement",
    key: ["priceId", "entitlementKey"],
  },
  entitlements: { delegate: "entitlement", model: "Entitlement", key: ["id"] },
  "store-product-mappings": {
    delegate: "storeProductMapping",
    model: "StoreProductMapping",
    key: ["id"],
  },
  "store-purchases": {
    delegate: "storePurchase",
    model: "StorePurchase",
    key: ["id"],
  },
  "store-notifications": {
    delegate: "storeNotification",
    model: "StoreNotification",
    key: ["provider", "eventId"],
  },
  "store-voids": {
    delegate: "storeVoid",
    model: "StoreVoid",
    key: ["provider", "eventId"],
  },
  "usage-records": {
    delegate: "usageRecord",
    model: "UsageRecord",
    key: ["id"],
  },
  "wallet-entries": {
    delegate: "walletEntry",
    model: "WalletEntry",
    key: ["id"],
  },
  "payment-method-tokens": {
    delegate: "paymentMethodToken",
    model: "PaymentMethodToken",
    key: ["id"],
  },
  subscriptions: {
    delegate: "subscription",
    model: "Subscription",
    key: ["id"],
  },
  invoices: { delegate: "invoice", model: "Invoice", key: ["id"] },
  "invoice-lines": {
    delegate: "invoiceLine",
    model: "InvoiceLine",
    key: ["id"],
  },
  "payment-records": {
    delegate: "paymentRecord",
    model: "PaymentRecord",
    key: ["id"],
  },
  "refund-records": {
    delegate: "refundRecord",
    model: "RefundRecord",
    key: ["id"],
  },
  "credit-notes": { delegate: "creditNote", model: "CreditNote", key: ["id"] },
  "subscription-renewals": {
    delegate: "subscriptionRenewal",
    model: "SubscriptionRenewal",
    key: ["subscriptionId", "invoiceId"],
  },
  "dunning-attempts": {
    delegate: "dunningAttempt",
    model: "DunningAttempt",
    key: ["id"],
  },
  coupons: { delegate: "coupon", model: "Coupon", key: ["id"] },
  "coupon-redemptions": {
    delegate: "couponRedemption",
    model: "CouponRedemption",
    key: ["id"],
  },
  "powertranz-sales": {
    delegate: "powerTranzSale",
    model: "PowerTranzSale",
    key: ["id"],
  },
  "payment-provider-events": {
    delegate: "paymentProviderEvent",
    model: "PaymentProviderEvent",
    key: ["id"],
  },
  companies: { delegate: "company", model: "Company", key: ["id"] },
  "ai-models": { delegate: "aiModel", model: "AiModel", key: ["id"] },
  "patron-configurations": {
    delegate: "patronConfiguration",
    model: "PatronConfiguration",
    key: ["id"],
  },
  "patron-budget-periods": {
    delegate: "patronBudgetPeriod",
    model: "PatronBudgetPeriod",
    key: ["id"],
  },
  "patron-action-credit-rules": {
    delegate: "patronActionCreditRule",
    model: "PatronActionCreditRule",
    key: ["id"],
  },
  "patron-user-profiles": {
    delegate: "patronUserProfile",
    model: "PatronUserProfile",
    key: ["userId"],
  },
  "patron-credit-entries": {
    delegate: "patronCreditEntry",
    model: "PatronCreditEntry",
    key: ["id"],
  },
  "email-configurations": {
    delegate: "emailConfiguration",
    model: "EmailConfiguration",
    key: ["id"],
  },
  "email-templates": {
    delegate: "emailTemplate",
    model: "EmailTemplate",
    key: ["id"],
  },
  "email-deliveries": {
    delegate: "emailDelivery",
    model: "EmailDelivery",
    key: ["id"],
  },
  "email-subscriptions": {
    delegate: "emailSubscription",
    model: "EmailSubscription",
    key: ["recipient", "topic"],
  },
  "sms-configurations": {
    delegate: "smsConfiguration",
    model: "SmsConfiguration",
    key: ["id"],
  },
  "sms-templates": {
    delegate: "smsTemplate",
    model: "SmsTemplate",
    key: ["id"],
  },
  "sms-deliveries": {
    delegate: "smsDelivery",
    model: "SmsDelivery",
    key: ["id"],
  },
  "sms-subscriptions": {
    delegate: "smsSubscription",
    model: "SmsSubscription",
    key: ["recipient", "topic"],
  },
  "notification-configurations": {
    delegate: "notificationConfiguration",
    model: "NotificationConfiguration",
    key: ["id"],
  },
  "notification-devices": {
    delegate: "notificationDevice",
    model: "NotificationDevice",
    key: ["id"],
  },
  "notification-deliveries": {
    delegate: "notificationDelivery",
    model: "NotificationDelivery",
    key: ["id"],
  },
  "notification-subscriptions": {
    delegate: "notificationSubscription",
    model: "NotificationSubscription",
    key: ["recipientId", "topic"],
  },
  "audit-events": { delegate: "auditEvent", model: "AuditEvent", key: ["id"] },
  "event-outbox": {
    delegate: "eventOutbox",
    model: "EventOutbox",
    key: ["id"],
  },
  memberships: {
    delegate: "membership",
    model: "Membership",
    key: ["userId", "companyId"],
  },
  "api-access-policies": {
    delegate: "apiAccessPolicy",
    model: "ApiAccessPolicy",
    key: ["id"],
  },
  "authorization-roles": {
    delegate: "authorizationRole",
    model: "AuthorizationRole",
    key: ["id"],
  },
  "authorization-role-permissions": {
    delegate: "authorizationRolePermission",
    model: "AuthorizationRolePermission",
    key: ["roleId", "permission"],
  },
  "user-authorization-roles": {
    delegate: "userAuthorizationRole",
    model: "UserAuthorizationRole",
    key: ["userId", "roleId"],
  },
};

const JSON_FIELDS = new Set([
  "categories",
  "changes",
  "data",
  "fallbackConfigurationIds",
  "payload",
]);

export class PrismaAdminDataRepository implements AdminDataRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(input: Parameters<AdminDataRepository["list"]>[0]) {
    const resource = RESOURCES[input.resource];
    if (!resource)
      throw new DomainError("USER_NOT_FOUND", "Admin resource not found.");
    const fields = scalarFields(resource.model);
    const redacted = new Set(input.redactedFields);
    const exposed = fields.filter((field) => !redacted.has(field));
    const queryable = exposed.filter((field) => !JSON_FIELDS.has(field));
    const sort = input.sort ?? resource.key[0]!;
    if (!queryable.includes(sort))
      throw new DomainError("INVALID_NAME", `Unsupported sort field: ${sort}.`);
    for (const filter of input.filters)
      if (!queryable.includes(filter.field))
        throw new DomainError(
          "INVALID_NAME",
          `Unsupported filter field: ${filter.field}.`,
        );

    const delegate = (this.prisma as unknown as Record<string, Delegate>)[
      resource.delegate
    ];
    if (!delegate)
      throw new Error(`Prisma delegate is missing for ${input.resource}.`);
    const orderBy = [
      { [sort]: input.order },
      ...resource.key
        .filter((field) => field !== sort)
        .map((field) => ({ [field]: input.order })),
    ];
    const args: Record<string, unknown> = {
      take: input.limit + 1,
      orderBy,
      select: Object.fromEntries(exposed.map((field) => [field, true])),
      ...(input.filters.length ? { where: where(input.filters) } : {}),
    };
    if (input.cursor) {
      args.cursor = unique(resource.key, input.cursor);
      args.skip = 1;
    }
    let rows: Record<string, unknown>[];
    try {
      rows = await delegate.findMany(args);
    } catch (error) {
      throw new DomainError(
        "INVALID_NAME",
        "Admin resource query is invalid.",
        {
          resource: input.resource,
          reason: error instanceof Error ? error.name : "unknown",
        },
      );
    }
    const hasMore = rows.length > input.limit;
    const data = rows.slice(0, input.limit).map(jsonRecord);
    const last = hasMore ? rows[input.limit - 1] : undefined;
    return {
      data,
      ...(last === undefined ? {} : { nextCursor: cursor(resource.key, last) }),
      sortableFields: queryable,
      filterableFields: queryable,
    };
  }
}

function scalarFields(model: string): string[] {
  const name = `${model}ScalarFieldEnum`;
  const values = (Prisma as unknown as Record<string, unknown>)[name];
  if (!values || typeof values !== "object")
    throw new Error(`Prisma scalar field metadata is missing for ${model}.`);
  return Object.values(values as Record<string, string>);
}

function where(filters: readonly AdminFilter[]) {
  return {
    AND: filters.map((filter) => ({
      [filter.field]:
        filter.operation === "eq"
          ? coerce(filter.value)
          : { [filter.operation]: coerce(filter.value) },
    })),
  };
}

function unique(
  fields: readonly string[],
  values: Record<string, string | number>,
) {
  const picked = Object.fromEntries(
    fields.map((field) => [field, coerce(values[field])]),
  );
  return fields.length === 1 ? picked : { [fields.join("_")]: picked };
}

function cursor(fields: readonly string[], row: Record<string, unknown>) {
  return Object.fromEntries(fields.map((field) => [field, scalar(row[field])]));
}

function scalar(value: unknown): string | number {
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  throw new Error("Cursor field is not scalar.");
}

function coerce(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : BigInt(value);
  }
  return value;
}

function jsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
  );
}

function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  return value;
}
