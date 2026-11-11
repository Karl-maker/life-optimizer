import { DomainError } from "../../domain/errors/index.js";
import type { Permission } from "../../domain/permissions/index.js";

export type AdminMutationPolicy =
  "managed" | "domain-only" | "append-only" | "read-only";

export interface AdminResourceDescriptor {
  name: string;
  permission: Permission;
  mutationPolicy: AdminMutationPolicy;
  redactedFields: readonly string[];
  description: string;
}

const resource = (
  name: string,
  permission: Permission,
  mutationPolicy: AdminMutationPolicy,
  description: string,
  redactedFields: readonly string[] = [],
): AdminResourceDescriptor => ({
  name,
  permission,
  mutationPolicy,
  redactedFields,
  description,
});

/**
 * Explicit database visibility policy. A resource omitted here is inaccessible;
 * redacted fields are removed in the database adapter before values leave it.
 */
export const ADMIN_RESOURCES = [
  resource(
    "users",
    "users:read",
    "domain-only",
    "Accounts and profile status.",
  ),
  resource(
    "oauth-identities",
    "users:read",
    "read-only",
    "Linked identity-provider subjects.",
    ["subject"],
  ),
  resource(
    "password-credentials",
    "system:read",
    "read-only",
    "Credential rotation metadata only.",
    ["passwordHash"],
  ),
  resource(
    "auth-sessions",
    "system:read",
    "domain-only",
    "Revocable session metadata.",
    ["secretHash"],
  ),
  resource(
    "auth-challenges",
    "system:read",
    "read-only",
    "Authentication challenge metadata.",
    ["secretHash"],
  ),
  resource(
    "login-audits",
    "audit:read",
    "append-only",
    "Authentication outcomes and bounded risk context.",
  ),
  resource(
    "user-devices",
    "users:read",
    "domain-only",
    "Registered client devices.",
    ["pushToken"],
  ),
  resource(
    "consent-receipts",
    "audit:read",
    "append-only",
    "Versioned user consent decisions.",
  ),
  resource(
    "financial-accounts",
    "finance:read",
    "domain-only",
    "User billing account identifiers.",
  ),
  resource(
    "financial-account-keys",
    "system:read",
    "domain-only",
    "External account-key bindings.",
    ["key"],
  ),
  resource(
    "entitlement-definitions",
    "products:read",
    "managed",
    "Entitlement catalogue definitions.",
  ),
  resource(
    "products",
    "products:read",
    "managed",
    "Public product catalogue records.",
  ),
  resource(
    "product-add-ons",
    "products:read",
    "managed",
    "Product add-on relationships.",
  ),
  resource(
    "prices",
    "products:read",
    "domain-only",
    "Immutable price offers; retire rather than rewrite.",
  ),
  resource(
    "price-entitlements",
    "products:read",
    "domain-only",
    "Entitlements granted by a price.",
  ),
  resource(
    "entitlements",
    "finance:read",
    "domain-only",
    "Granted and revoked account entitlements.",
  ),
  resource(
    "store-product-mappings",
    "products:read",
    "domain-only",
    "Store SKU mappings.",
  ),
  resource(
    "store-purchases",
    "payments:read",
    "domain-only",
    "Verified store purchases.",
  ),
  resource(
    "store-notifications",
    "payments:read",
    "append-only",
    "Deduplicated store webhook facts.",
  ),
  resource(
    "store-voids",
    "payments:read",
    "append-only",
    "Store void and revocation facts.",
  ),
  resource(
    "usage-records",
    "finance:read",
    "append-only",
    "Entitlement usage ledger.",
  ),
  resource(
    "wallet-entries",
    "finance:read",
    "append-only",
    "Wallet accounting ledger.",
  ),
  resource(
    "payment-method-tokens",
    "payments:read",
    "domain-only",
    "Redacted payment-method metadata.",
    ["tokenReference"],
  ),
  resource(
    "subscriptions",
    "payments:read",
    "domain-only",
    "Subscription lifecycle state.",
  ),
  resource(
    "invoices",
    "payments:read",
    "domain-only",
    "Invoice totals and status.",
  ),
  resource(
    "invoice-lines",
    "payments:read",
    "append-only",
    "Immutable invoice line snapshots.",
  ),
  resource(
    "payment-records",
    "payments:read",
    "append-only",
    "Provider payment facts.",
  ),
  resource(
    "refund-records",
    "payments:read",
    "append-only",
    "Provider refund facts.",
  ),
  resource(
    "credit-notes",
    "payments:read",
    "append-only",
    "Issued credit notes.",
  ),
  resource(
    "subscription-renewals",
    "payments:read",
    "append-only",
    "Subscription renewal facts.",
  ),
  resource(
    "dunning-attempts",
    "payments:read",
    "append-only",
    "Payment recovery attempts.",
  ),
  resource("coupons", "products:read", "managed", "Discount definitions."),
  resource(
    "coupon-redemptions",
    "payments:read",
    "append-only",
    "Coupon redemption ledger.",
  ),
  resource(
    "powertranz-sales",
    "payments:read",
    "domain-only",
    "PowerTranz sale state.",
    ["tokenHash"],
  ),
  resource(
    "payment-provider-events",
    "payments:read",
    "append-only",
    "Provider webhook reconciliation metadata.",
  ),
  resource("companies", "companies:read", "domain-only", "Company records."),
  resource(
    "ai-models",
    "ai-providers:read",
    "managed",
    "Provider-neutral AI model catalogue.",
  ),
  resource(
    "patron-configurations",
    "finance:read",
    "managed",
    "AI patron budget configuration.",
  ),
  resource(
    "patron-budget-periods",
    "finance:read",
    "managed",
    "Budget period configuration.",
  ),
  resource(
    "patron-action-credit-rules",
    "finance:read",
    "managed",
    "AI credit action rules.",
  ),
  resource(
    "patron-user-profiles",
    "finance:read",
    "domain-only",
    "Per-user patron state.",
  ),
  resource(
    "patron-credit-entries",
    "finance:read",
    "append-only",
    "Patron credit ledger.",
  ),
  resource(
    "email-configurations",
    "system:read",
    "managed",
    "Email delivery configuration.",
  ),
  resource("email-templates", "system:read", "managed", "Email templates."),
  resource(
    "email-deliveries",
    "system:read",
    "append-only",
    "Email delivery history.",
    ["recipient", "renderedHtml", "renderedText"],
  ),
  resource(
    "email-subscriptions",
    "system:read",
    "domain-only",
    "Email subscription preferences.",
    ["recipient"],
  ),
  resource(
    "sms-configurations",
    "system:read",
    "managed",
    "SMS delivery configuration.",
  ),
  resource("sms-templates", "system:read", "managed", "SMS templates."),
  resource(
    "sms-deliveries",
    "system:read",
    "append-only",
    "SMS delivery history.",
    ["recipient", "renderedBody"],
  ),
  resource(
    "sms-subscriptions",
    "system:read",
    "domain-only",
    "SMS subscription preferences.",
    ["recipient"],
  ),
  resource(
    "notification-configurations",
    "system:read",
    "managed",
    "Push notification configuration.",
  ),
  resource(
    "notification-devices",
    "system:read",
    "domain-only",
    "Push endpoints.",
    ["endpoint"],
  ),
  resource(
    "notification-deliveries",
    "system:read",
    "append-only",
    "Push delivery history.",
    ["title", "body", "data"],
  ),
  resource(
    "notification-subscriptions",
    "system:read",
    "domain-only",
    "Push subscription preferences.",
  ),
  resource(
    "audit-events",
    "audit:read",
    "append-only",
    "Append-only business audit trail.",
  ),
  resource(
    "event-outbox",
    "system:read",
    "append-only",
    "Transactional integration event outbox.",
    ["payload"],
  ),
  resource(
    "memberships",
    "companies:read",
    "domain-only",
    "Company access memberships.",
  ),
  resource(
    "api-access-policies",
    "permissions:read",
    "managed",
    "Endpoint allow and deny policy.",
  ),
  resource(
    "authorization-roles",
    "permissions:read",
    "managed",
    "Administrative role definitions.",
  ),
  resource(
    "authorization-role-permissions",
    "permissions:read",
    "managed",
    "Role permission mappings.",
  ),
  resource(
    "user-authorization-roles",
    "permissions:read",
    "managed",
    "Audited user role assignments.",
  ),
] as const satisfies readonly AdminResourceDescriptor[];

export type AdminFilter = {
  field: string;
  operation: "eq" | "contains" | "gte" | "lte";
  value: string;
};

export interface AdminDataRepository {
  list(input: {
    resource: string;
    limit: number;
    cursor?: Record<string, string | number>;
    sort?: string;
    order: "asc" | "desc";
    filters: readonly AdminFilter[];
    redactedFields: readonly string[];
  }): Promise<{
    data: readonly Record<string, unknown>[];
    nextCursor?: Record<string, string | number>;
    sortableFields: readonly string[];
    filterableFields: readonly string[];
  }>;
}

export function createAdminDataService(repository: AdminDataRepository) {
  const byName = new Map(ADMIN_RESOURCES.map((value) => [value.name, value]));
  return {
    resources(permissions: readonly string[]) {
      return ADMIN_RESOURCES.filter((value) =>
        permissions.includes(value.permission),
      );
    },
    list(input: {
      resource: string;
      permissions: readonly string[];
      limit: number;
      cursor?: Record<string, string | number>;
      sort?: string;
      order?: "asc" | "desc";
      filters?: readonly AdminFilter[];
    }) {
      const descriptor = byName.get(input.resource);
      if (!descriptor)
        throw new DomainError("USER_NOT_FOUND", "Admin resource not found.");
      if (!input.permissions.includes(descriptor.permission))
        throw new DomainError(
          "FORBIDDEN",
          `Permission ${descriptor.permission} is required.`,
        );
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100
      )
        throw new DomainError(
          "INVALID_NAME",
          "Admin resource limit must be 1-100.",
        );
      return repository.list({
        resource: descriptor.name,
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.sort === undefined ? {} : { sort: input.sort }),
        order: input.order ?? "asc",
        filters: input.filters ?? [],
        redactedFields: descriptor.redactedFields,
      });
    },
  };
}

export type AdminDataService = ReturnType<typeof createAdminDataService>;
