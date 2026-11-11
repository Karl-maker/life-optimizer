import { describe, expect, it, vi } from "vitest";
import { defaultPatronConfiguration } from "@edu-service/patron";
import { createApiServer, type ApiServerOptions } from "../src/index.js";

const userId = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const authenticator = {
  authenticate: async () => ({
    id: userId,
    kind: "bearer" as const,
    permissions: [
      "user",
      "financial:manage",
      "products:write",
      "payments:refund",
    ],
  }),
};

describe("platform commerce routes", () => {
  it("creates a server-priced payment and returns the provider redirect", async () => {
    const issueInvoice = vi.fn(async () => ({
      id,
      accountId: id,
      idempotencyKey: "purchase-1",
      currency: "USD",
      subtotalMinor: 2500n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 2500n,
      status: "open",
      provider: null,
      providerReference: null,
      subscriptionId: null,
      dueAt: null,
      issuedAt: new Date(),
      paidAt: null,
      lines: [],
    }));
    const createOneOffCheckout = vi.fn(async () => ({
      providerReference: "cs_purchase_1",
      checkoutUrl: "https://pay.example.test/session",
    }));
    const commerce = {
      billing: {
        issueInvoice,
        bindInvoiceProvider: async (input: {
          provider: string;
          providerReference: string;
        }) => ({
          ...(await issueInvoice()),
          provider: input.provider,
          providerReference: input.providerReference,
        }),
      },
      financial: { bindAccountKey: async () => ({ created: true }) },
      reporting: { listCatalog: async () => [] },
      findInvoice: async () => null,
      findAccountById: async () => null,
      authenticator,
      providers: [{ id: "stripe", createOneOffCheckout }],
    } as unknown as NonNullable<ApiServerOptions["commerce"]>;
    const app = await createApiServer({ commerce });
    const response = await app.inject({
      method: "POST",
      url: "/payments",
      headers: {
        authorization: "Bearer test",
        "idempotency-key": "purchase-1",
      },
      payload: {
        priceId: id,
        provider: "stripe",
        successUrl: "https://app.example.test/success",
        cancelUrl: "https://app.example.test/cancel",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(issueInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        lines: [{ priceId: id, quantity: 1n, taxRateBps: 0 }],
      }),
    );
    expect(createOneOffCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: { currency: "USD", amountMinor: 2500n },
      }),
    );
    expect(response.json()).toMatchObject({
      status: "pending",
      nextAction: { type: "redirect" },
    });
    await app.close();
  });

  it("loads a catalog product directly instead of searching a bounded page", async () => {
    const getCatalogProduct = vi.fn(async () => ({
      id,
      key: "course.intro",
      name: "Intro course",
      createdAt: new Date("2026-11-10T00:00:00Z"),
      prices: [],
    }));
    const app = await createApiServer({
      commerce: {
        billing: {} as never,
        financial: {} as never,
        reporting: { getCatalogProduct } as never,
        findInvoice: async () => null,
        findAccountById: async () => null,
        authenticator,
        providers: [],
      },
    });
    const response = await app.inject({
      method: "GET",
      url: `/products/${id}`,
    });
    expect(response.statusCode).toBe(200);
    expect(getCatalogProduct).toHaveBeenCalledWith(id);
    expect(response.json()).toMatchObject({ id, key: "course.intro" });
    await app.close();
  });

  it("serializes retired price minor units according to the documented string contract", async () => {
    const app = await createApiServer({
      commerce: {
        billing: {
          retirePrice: async () => ({
            id,
            productId: userId,
            currency: "USD",
            unitAmountMinor: 2500n,
            frequency: "one_time",
            intervalCount: 1,
            trialDays: 0,
            active: false,
          }),
        } as never,
        financial: {} as never,
        reporting: {} as never,
        findInvoice: async () => null,
        findAccountById: async () => null,
        authenticator,
        providers: [],
      },
    });
    const response = await app.inject({
      method: "DELETE",
      url: `/admin/prices/${id}`,
      headers: { authorization: "Bearer test" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().unitAmountMinor).toBe("2500");
    await app.close();
  });

  it("scopes S3 keys to the authenticated user", async () => {
    const createUploadUrl = vi.fn(async (input: { key: string }) => ({
      key: input.key,
      path: `s3://bucket/${input.key}`,
      url: `https://cdn.example.test/${input.key}`,
      uploadUrl: "https://s3.example.test/signed",
      expiresAt: new Date("2026-11-10T12:15:00Z"),
    }));
    const app = await createApiServer({
      uploads: {
        authenticator,
        store: { createUploadUrl } as unknown as NonNullable<
          NonNullable<ApiServerOptions["uploads"]>["store"]
        >,
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: { authorization: "Bearer test" },
      payload: {
        key: "avatars/me.png",
        contentType: "image/png",
        contentLength: 1024,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(createUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `users/${userId}/avatars/me.png`,
        contentLength: 1024,
      }),
    );
    expect(response.body).not.toContain("credential");
    await app.close();
  });

  it("lists Patron profiles only through the financial manager permission", async () => {
    const listProfiles = vi.fn(async () => [
      {
        userId,
        tier: "T1",
        valueScore: 100,
        potentialScore: 20,
        provisional: false,
        periodStart: new Date(),
        periodEnd: new Date(),
        allowanceRemainingCredits: 50n,
        updatedAt: new Date(),
      },
    ]);
    const patrons = {
      service: { listProfiles } as unknown as NonNullable<
        ApiServerOptions["patrons"]
      >["service"],
      authenticator,
    };
    const app = await createApiServer({ patrons });
    const response = await app.inject({
      method: "GET",
      url: "/admin/patrons?tier=T1&search=test",
      headers: { authorization: "Bearer test" },
    });
    expect(response.statusCode).toBe(200);
    expect(listProfiles).toHaveBeenCalledWith({
      limit: 25,
      tier: "T1",
      search: "test",
    });
    expect(response.json().data[0]).toMatchObject({
      userId,
      allowanceRemainingCredits: "50",
    });
    await app.close();
  });

  it("reads and replaces Patron configuration through the admin account", async () => {
    const configuration = defaultPatronConfiguration(
      new Date("2026-11-10T12:00:00Z"),
    );
    const configure = vi.fn(
      async (input: { config: typeof configuration }) => input.config,
    );
    const app = await createApiServer({
      patrons: {
        authenticator,
        service: {
          configuration: async () => configuration,
          configure,
        } as unknown as NonNullable<ApiServerOptions["patrons"]>["service"],
      },
    });

    const current = await app.inject({
      method: "GET",
      url: "/admin/patrons/configuration",
      headers: { authorization: "Bearer test" },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({
      key: "default",
      budget: { ceilingCredits: "100000" },
      taskClasses: { final_answer: { estimatedCredits: "8" } },
    });

    const { key: _key, updatedAt: _updatedAt, ...input } = configuration;
    const payload = JSON.parse(
      JSON.stringify(input, (_name, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    );
    payload.version = 2;
    payload.flatMode = true;
    const updated = await app.inject({
      method: "PUT",
      url: "/admin/patrons/configuration",
      headers: { authorization: "Bearer test" },
      payload,
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()).toMatchObject({ version: 2, flatMode: true });
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ permissions: ["financial:manage"] }),
        config: expect.objectContaining({
          key: "default",
          version: 2,
          flatMode: true,
          monthlyAllowances: expect.objectContaining({ T3: 2000n }),
        }),
      }),
    );
    await app.close();
  });
});
