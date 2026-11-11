import { describe, expect, it } from "vitest";
import { PowerTranzAdapter, readFinancialConfiguration } from "../src/index.js";

const transactionIdentifier = "40511888-ad35-4bba-8dcb-214f493e185c";
const orderIdentifier = "order-1234";
const amount = { currency: "USD", amountMinor: 1250n };
const start = {
  TransactionIdentifier: transactionIdentifier,
  OrderIdentifier: orderIdentifier,
  TotalAmount: 12.5,
  CurrencyCode: "840",
  Approved: false,
  IsoResponseCode: "SP4",
  SpiToken: "spi-test-token",
  RedirectData: "<form></form>",
};
const paid = {
  TransactionIdentifier: transactionIdentifier,
  OrderIdentifier: orderIdentifier,
  TotalAmount: 12.5,
  CurrencyCode: "840",
  Approved: true,
  IsoResponseCode: "00",
  CardBrand: "Visa",
  CardSuffix: "4242",
  PanToken: "provider-card-token",
};
const browserResult = {
  ...start,
  IsoResponseCode: "3D0",
  RiskManagement: {
    ThreeDSecure: { AuthenticationStatus: "Y", Eci: "05", Cavv: "test-only" },
  },
};

function setup(responses: unknown[]) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const adapter = new PowerTranzAdapter({
    baseUrl: "https://staging.ptranz.com/Api",
    merchantId: "merchant",
    merchantPassword: "secret",
    pageSet: "PTZ/Hosted",
    pageName: "Payment",
    currency: "USD",
    numericCurrencyCode: "840",
    currencyExponent: 2,
    clock: () => new Date("2026-10-31T12:00:00Z"),
    fetch: (async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  return { adapter, requests };
}

describe("PowerTranz hosted SPI adapter", () => {
  it("reports missing configuration without logging credentials and enables a complete merchant setup", () => {
    const events: {
      name: string;
      attributes?: Record<string, string | number | boolean | null>;
    }[] = [];
    const log = {
      info: () => undefined,
      error: (
        name: string,
        attributes?: Record<string, string | number | boolean | null>,
      ) => {
        events.push({ name, ...(attributes ? { attributes } : {}) });
      },
    };
    expect(readFinancialConfiguration({}, log).powertranz).toBeNull();
    expect(() =>
      readFinancialConfiguration({ EDU_STRIPE_SECRET_KEY: "sk_test_only" }),
    ).toThrow("EDU_STRIPE_SECRET_KEY");
    expect(() =>
      readFinancialConfiguration({
        EDU_POWERTRANZ_BASE_URL: "https://staging.ptranz.com/Api",
      }),
    ).toThrow("EDU_POWERTRANZ");
    expect(events).toContainEqual({
      name: "financial.provider.unavailable",
      attributes: { provider: "powertranz", reason: "missing_configuration" },
    });
    const adapter = readFinancialConfiguration(
      {
        EDU_POWERTRANZ_BASE_URL: "https://staging.ptranz.com/Api",
        EDU_POWERTRANZ_MERCHANT_ID: "merchant",
        EDU_POWERTRANZ_MERCHANT_PASSWORD: "secret",
        EDU_POWERTRANZ_PAGE_SET: "PTZ/Hosted",
        EDU_POWERTRANZ_PAGE_NAME: "Pay",
        EDU_POWERTRANZ_CURRENCY: "USD",
        EDU_POWERTRANZ_CURRENCY_CODE: "840",
        EDU_POWERTRANZ_CURRENCY_EXPONENT: "2",
      },
      log,
    ).powertranz;
    expect(adapter).toBeInstanceOf(PowerTranzAdapter);
    expect(JSON.stringify(events)).not.toContain("secret");
  });
  it("starts HPP with merchant credentials and completes only after an approved matched server response", async () => {
    const t = setup([start, paid]);
    const session = await t.adapter.beginHostedSale({
      transactionIdentifier,
      orderIdentifier,
      amount,
      merchantResponseUrl: "https://example.com/powertranz/result",
      threeDSecure: true,
    });
    expect(session.spiToken).toBe("spi-test-token");
    const requestBody = JSON.parse(String(t.requests[0]?.init?.body));
    expect(requestBody).toMatchObject({
      CurrencyCode: "840",
      TotalAmount: 12.5,
      ThreeDSecure: true,
      ExtendedData: { HostedPage: { PageSet: "PTZ/Hosted" } },
    });
    expect(
      (t.requests[0]?.init?.headers as Record<string, string>)[
        "PowerTranz-PowerTranzPassword"
      ],
    ).toBe("secret");
    const result = await t.adapter.completeHostedSale({
      session,
      browserResult,
    });
    expect(result).toMatchObject({
      approved: true,
      isoResponseCode: "00",
      cardLast4: "4242",
    });
    expect(t.requests[1]?.url).toBe(
      "https://staging.ptranz.com/Api/spi/Payment",
    );
    expect(
      (t.requests[1]?.init?.headers as Record<string, string>)[
        "PowerTranz-PowerTranzPassword"
      ],
    ).toBeUndefined();
  });

  it("rejects a mismatched browser callback before any financial request", async () => {
    const t = setup([start]);
    const session = await t.adapter.beginHostedSale({
      transactionIdentifier,
      orderIdentifier,
      amount,
      merchantResponseUrl: "https://example.com/result",
      threeDSecure: true,
    });
    await expect(
      t.adapter.completeHostedSale({
        session,
        browserResult: { ...browserResult, TotalAmount: 1 },
      }),
    ).rejects.toThrow();
    expect(t.requests).toHaveLength(1);
  });
  it("reconciles only an approved query matching stored money", async () => {
    const approved = setup([
      {
        TransactionIdentifier: transactionIdentifier,
        IsoResponseCode: "00",
        TotalAmount: 12.5,
        CurrencyCode: "840",
      },
    ]);
    expect(
      await approved.adapter.queryApprovedSale({
        transactionIdentifier,
        amount,
      }),
    ).toBe(true);
    const wrongAmount = setup([
      {
        TransactionIdentifier: transactionIdentifier,
        IsoResponseCode: "00",
        TotalAmount: 13,
        CurrencyCode: "840",
      },
    ]);
    expect(
      await wrongAmount.adapter.queryApprovedSale({
        transactionIdentifier,
        amount,
      }),
    ).toBe(false);
  });

  it("rejects failed 3DS and an unmatched payment response", async () => {
    const t = setup([start, { ...paid, TotalAmount: 13 }]);
    const session = await t.adapter.beginHostedSale({
      transactionIdentifier,
      orderIdentifier,
      amount,
      merchantResponseUrl: "https://example.com/result",
      threeDSecure: true,
    });
    await expect(
      t.adapter.completeHostedSale({
        session,
        browserResult: {
          ...browserResult,
          RiskManagement: {
            ThreeDSecure: {
              AuthenticationStatus: "N",
              Eci: "05",
              Cavv: "test",
            },
          },
        },
      }),
    ).rejects.toThrow();
    await expect(
      t.adapter.completeHostedSale({ session, browserResult }),
    ).rejects.toThrow();
  });
});
