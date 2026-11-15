import { describe, expect, it } from "vitest";
import type { Actor, AuditContext } from "@life-optimizer/core";
import {
  createStorePurchaseService,
  type StorePurchase,
  type StoreProductMapping,
  type VerifiedStorePurchase,
  type StorePurchaseRepository,
  type StorePurchaseTransactionRunner,
  type BillingRepository,
  type FinancialRepository,
} from "../src/index.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherUser = "00000000-0000-4000-8000-000000000002";
const priceId = "00000000-0000-4000-8000-000000000003";
const at = new Date("2026-10-31T12:00:00Z");
const manager: Actor = {
  kind: "agent",
  agentId: "store-worker",
  onBehalfOf: userId,
  permissions: ["financial:manage"],
};
const audit: AuditContext = {
  correlationId: "store-test",
  source: "api",
  actorSource: "service",
};
function verified(
  overrides: Partial<VerifiedStorePurchase> = {},
): VerifiedStorePurchase {
  return {
    provider: "apple",
    transactionId: "tx.1",
    originalTransactionId: "tx.1",
    tokenHash: null,
    accountKey: "iap.apple.account-1",
    sku: "course.gold",
    kind: "one_time",
    status: "active",
    environment: "sandbox",
    quantity: 1,
    currency: "USD",
    priceMilliunits: 1990n,
    purchasedAt: at,
    expiresAt: null,
    observedAt: at,
    ...overrides,
  };
}
function setup(recurring = false) {
  const mappings = new Map<string, StoreProductMapping>();
  const purchases = new Map<string, StorePurchase>();
  const grants: {
    id: string;
    storePurchaseId: string;
    revokedAt: Date | null;
    endsAt: Date | null;
  }[] = [];
  const notifications = new Set<string>();
  const voids = new Map<string, string>();
  const audits: string[] = [];
  const events: string[] = [];
  const store: StorePurchaseRepository = {
    findMapping: async (provider, sku) =>
      mappings.get(`${provider}:${sku}`) ?? null,
    saveMapping: async (mapping) => {
      mappings.set(`${mapping.provider}:${mapping.sku}`, mapping);
      return mapping;
    },
    findByTransaction: async (provider, id) =>
      purchases.get(`${provider}:${id}`) ?? null,
    findByOriginal: async (provider, id) =>
      [...purchases.values()].find(
        (row) =>
          row.provider === provider &&
          row.originalTransactionId === id &&
          row.accountId,
      ) ?? null,
    findByTokenHash: async (provider, hash) =>
      [...purchases.values()].find(
        (row) =>
          row.provider === provider && row.tokenHash === hash && row.accountId,
      ) ?? null,
    findVoid: async (provider, transactionId) => {
      const tokenHash = voids.get(`${provider}:${transactionId}`);
      return tokenHash ? { tokenHash } : null;
    },
    recordVoid: async ({ provider, transactionId, tokenHash }) => {
      const key = `${provider}:${transactionId}`;
      const existing = voids.get(key);
      if (existing && existing !== tokenHash)
        throw new Error("Store void token mismatch");
      if (existing) return false;
      voids.set(key, tokenHash);
      return true;
    },
    savePurchase: async (row) => {
      const key = `${row.provider}:${row.transactionId}`;
      const old = purchases.get(key);
      if (old && old.observedAt > row.observedAt)
        return { purchase: old, changed: false, created: false };
      const next = {
        ...row,
        id: old?.id ?? row.id,
        createdAt: old?.createdAt ?? row.createdAt,
      };
      const changed =
        !old ||
        old.status !== next.status ||
        old.accountId !== next.accountId ||
        old.expiresAt?.getTime() !== next.expiresAt?.getTime();
      purchases.set(key, next);
      return { purchase: next, changed, created: !old };
    },
    listGrants: async (id) =>
      grants.filter((grant) => grant.storePurchaseId === id),
    listForAccount: async (id, cursor, limit) =>
      [...purchases.values()]
        .filter(
          (row) =>
            row.accountId === id &&
            (!cursor ||
              row.createdAt < cursor.createdAt ||
              (row.createdAt.getTime() === cursor.createdAt.getTime() &&
                row.id < cursor.id)),
        )
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.id.localeCompare(a.id),
        )
        .slice(0, limit),
    recordNotification: async ({ provider, eventId }) => {
      const key = `${provider}:${eventId}`;
      if (notifications.has(key)) return false;
      notifications.add(key);
      return true;
    },
  };
  const financial = {
    ensureAccount: async (id: string) => ({ id: `account:${id}`, userId: id }),
    findAccountByKey: async (key: string) =>
      key === "iap.apple.account-1" || key === "iap.google.account-1"
        ? { id: `account:${userId}`, userId }
        : null,
    listPriceEntitlements: async () => [
      { priceId, entitlementKey: "course.access", quantity: 1n },
    ],
    grantEntitlement: async (value: {
      storePurchaseId: string;
      endsAt: Date | null;
    }) => {
      const grant = {
        id: `grant-${grants.length}`,
        storePurchaseId: value.storePurchaseId,
        revokedAt: null,
        endsAt: value.endsAt,
      };
      grants.push(grant);
      return { ...value, ...grant, key: "course.access" };
    },
    revokeEntitlement: async (id: string, when: Date) => {
      const grant = grants.find((value) => value.id === id)!;
      grant.revokedAt = when;
      return grant;
    },
  } as unknown as FinancialRepository;
  const billing = {
    findPrice: async () => ({
      id: priceId,
      productId: "product-1",
      currency: "USD",
      unitAmountMinor: 100n,
      frequency: recurring ? "month" : "one_time",
      intervalCount: 1,
      trialDays: 0,
      active: true,
      productName: "Course",
      productActive: true,
      productRiskLevel: "low",
    }),
  } as unknown as BillingRepository;
  const tx = {
    run: async (work: Parameters<StorePurchaseTransactionRunner["run"]>[0]) =>
      work({
        store,
        financial,
        billing,
        audit: {
          append: async (value: { action: string }) => {
            audits.push(value.action);
          },
        } as never,
        events: {
          append: async (value: { type: string }) => {
            events.push(value.type);
          },
        } as never,
      }),
  } as StorePurchaseTransactionRunner;
  return {
    service: createStorePurchaseService({
      repository: store,
      transactions: tx,
      clock: () => at,
    }),
    grants,
    audits,
    events,
    purchases,
    mappings,
  };
}

describe("verified store purchases", () => {
  it("maps a SKU, records the transaction once and grants the mapped entitlement", async () => {
    const env = setup();
    await env.service.mapProduct({
      actor: manager,
      audit,
      provider: "apple",
      sku: "course.gold",
      priceId,
    });
    const first = await env.service.sync({
      actor: manager,
      audit,
      purchase: verified(),
      notification: { eventId: "note.1", type: "SUBSCRIBED" },
    });
    expect(first).toMatchObject({ created: true, granted: 1, revoked: 0 });
    const second = await env.service.sync({
      actor: manager,
      audit,
      purchase: verified(),
      notification: { eventId: "note.1", type: "SUBSCRIBED" },
    });
    expect(second).toMatchObject({ created: false, granted: 0, revoked: 0 });
    expect(env.grants).toHaveLength(1);
    expect(env.events).toContain("financial.store-purchase.synced");
    expect(env.events).toContain("financial.entitlement.granted");
  });
  it("keeps unbound notifications unclaimed and blocks another user's claim", async () => {
    const env = setup();
    await env.service.mapProduct({
      actor: manager,
      audit,
      provider: "apple",
      sku: "course.gold",
      priceId,
    });
    const result = await env.service.sync({
      actor: manager,
      audit,
      purchase: verified({ accountKey: null }),
    });
    expect(result.granted).toBe(0);
    await expect(
      env.service.sync({
        actor: { kind: "user", userId: otherUser },
        userId: otherUser,
        audit,
        purchase: verified(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(env.grants).toHaveLength(0);
  });
  it("revokes a refunded transaction and ignores an older active snapshot", async () => {
    const env = setup();
    await env.service.mapProduct({
      actor: manager,
      audit,
      provider: "apple",
      sku: "course.gold",
      priceId,
    });
    await env.service.sync({ actor: manager, audit, purchase: verified() });
    const refunded = await env.service.sync({
      actor: manager,
      audit,
      purchase: verified({
        status: "revoked",
        permanentlyRevoked: true,
        observedAt: new Date(at.getTime() + 1000),
      }),
    });
    expect(refunded.revoked).toBe(1);
    const stale = await env.service.sync({
      actor: manager,
      audit,
      purchase: verified(),
    });
    expect(stale.purchase.status).toBe("revoked");
    const later = await env.service.sync({
      actor: manager,
      audit,
      purchase: verified({ observedAt: new Date(at.getTime() + 2000) }),
    });
    expect(later.purchase.status).toBe("revoked");
    expect(env.grants[0]?.revokedAt).not.toBeNull();
  });
  it("grants a verified subscription only through its expiry and rejects SKU reassignment", async () => {
    const env = setup();
    await env.service.mapProduct({
      actor: manager,
      audit,
      provider: "apple",
      sku: "course.gold",
      priceId,
    });
    await expect(
      env.service.mapProduct({
        actor: manager,
        audit,
        provider: "apple",
        sku: "course.gold",
        priceId: "00000000-0000-4000-8000-000000000004",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A one-time price cannot silently become a subscription offer.
    await expect(
      env.service.sync({
        actor: manager,
        audit,
        purchase: verified({
          kind: "subscription",
          expiresAt: new Date(at.getTime() + 86400000),
        }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
  });
  it("suspends a subscription during account hold and restores it after provider recovery", async () => {
    const env = setup(true);
    await env.service.mapProduct({
      actor: manager,
      audit,
      provider: "apple",
      sku: "course.gold",
      priceId,
    });
    const active = verified({
      kind: "subscription",
      expiresAt: new Date(at.getTime() + 86_400_000),
    });
    expect(
      (await env.service.sync({ actor: manager, audit, purchase: active }))
        .granted,
    ).toBe(1);
    expect(
      (
        await env.service.sync({
          actor: manager,
          audit,
          purchase: {
            ...active,
            status: "suspended",
            observedAt: new Date(at.getTime() + 1000),
          },
          notification: { eventId: "hold.1", type: "SUBSCRIPTION_5" },
        })
      ).revoked,
    ).toBe(1);
    expect(
      (
        await env.service.sync({
          actor: manager,
          audit,
          purchase: { ...active, observedAt: new Date(at.getTime() + 2000) },
          notification: { eventId: "recovered.1", type: "SUBSCRIPTION_1" },
        })
      ).granted,
    ).toBe(1);
    expect(env.grants).toHaveLength(2);
    expect(env.events).toContain("financial.store-subscription.billing_failed");
  });
  it("reinstates a refunded purchase only after a verified refund reversal", async () => {
    const env = setup();
    await env.service.mapProduct({
      actor: manager,
      audit,
      provider: "apple",
      sku: "course.gold",
      priceId,
    });
    await env.service.sync({ actor: manager, audit, purchase: verified() });
    await env.service.sync({
      actor: manager,
      audit,
      purchase: verified({
        status: "revoked",
        permanentlyRevoked: true,
        observedAt: new Date(at.getTime() + 1000),
      }),
    });
    const result = await env.service.sync({
      actor: manager,
      audit,
      purchase: verified({
        reinstatement: true,
        observedAt: new Date(at.getTime() + 2000),
      }),
    });
    expect(result.granted).toBe(1);
    expect(result.purchase.permanentlyRevoked).toBe(false);
  });
  it("uses a Google void's order and token hash to revoke the exact purchase", async () => {
    const env = setup();
    await env.service.mapProduct({
      actor: manager,
      audit,
      provider: "google",
      sku: "course.gold",
      priceId,
    });
    const tokenHash = "a".repeat(64);
    await env.service.sync({
      actor: manager,
      audit,
      purchase: verified({
        provider: "google",
        transactionId: "GPA.1234",
        originalTransactionId: tokenHash,
        tokenHash,
        accountKey: "iap.google.account-1",
        currency: null,
        priceMilliunits: null,
      }),
    });
    await expect(
      env.service.voidGoogleOrder({
        actor: manager,
        audit,
        eventId: "void.1",
        orderId: "GPA.1234",
        tokenHash: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const result = await env.service.voidGoogleOrder({
      actor: manager,
      audit,
      eventId: "void.1",
      orderId: "GPA.1234",
      tokenHash,
    });
    expect(result.matched).toBe(true);
    expect(env.grants[0]?.revokedAt).not.toBeNull();
    expect(
      (
        await env.service.voidGoogleOrder({
          actor: manager,
          audit,
          eventId: "void.1",
          orderId: "GPA.1234",
          tokenHash,
        })
      ).matched,
    ).toBe(true);
    expect(env.grants).toHaveLength(1);
  });
  it("keeps an unclaimed Google void from granting a later purchase claim", async () => {
    const env = setup();
    await env.service.mapProduct({
      actor: manager,
      audit,
      provider: "google",
      sku: "course.gold",
      priceId,
    });
    const tokenHash = "a".repeat(64);
    expect(
      (
        await env.service.voidGoogleOrder({
          actor: manager,
          audit,
          eventId: "void.unknown",
          orderId: "GPA.9999",
          tokenHash,
        })
      ).matched,
    ).toBe(false);
    const result = await env.service.sync({
      actor: manager,
      audit,
      purchase: verified({
        provider: "google",
        transactionId: "GPA.9999",
        originalTransactionId: tokenHash,
        tokenHash,
        accountKey: "iap.google.account-1",
        currency: null,
        priceMilliunits: null,
      }),
    });
    expect(result.purchase.status).toBe("revoked");
    expect(result.purchase.permanentlyRevoked).toBe(true);
    expect(result.granted).toBe(0);
    expect(env.grants).toHaveLength(0);
    expect(env.events).toContain("financial.store-void.recorded");
  });
});
