import { DomainError } from "@life-optimizer/core";
import type { Money } from "./index.js";

/** Only the SPI hosted-page flow is exposed. Card data never enters this adapter. */
export interface PowerTranzHostedSession {
  transactionIdentifier: string;
  orderIdentifier: string;
  amount: Money;
  /** Store server side; never put this token in a user-facing API response or log. */
  spiToken: string;
  expiresAt: Date;
  /** Render only inside a tightly sandboxed provider iframe. */
  redirectData: string;
  threeDSecure: boolean;
}

export interface PowerTranzResult {
  transactionIdentifier: string;
  orderIdentifier: string;
  approved: boolean;
  isoResponseCode: string;
  amount: Money;
  cardBrand: string | null;
  cardLast4: string | null;
  panToken: string | null;
}

export class PowerTranzProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PowerTranzProtocolError";
  }
}
export class PowerTranzAuthenticationError extends PowerTranzProtocolError {
  constructor() {
    super("PowerTranz authentication did not complete.");
    this.name = "PowerTranzAuthenticationError";
  }
}

type RecordValue = Record<string, unknown>;
const guid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeReference = /^[A-Za-z0-9._:-]{4,128}$/;

function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PowerTranzProtocolError(
      "PowerTranz returned an invalid response.",
    );
  return value as RecordValue;
}

function string(value: unknown, max = 255): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    throw new PowerTranzProtocolError(
      "PowerTranz returned an invalid response field.",
    );
  return value;
}

function validateMoney(
  amount: Money,
  currency: string,
  exponent: number,
): number {
  if (
    amount.currency !== currency ||
    amount.amountMinor <= 0n ||
    amount.amountMinor > 99_999_999n
  )
    throw new DomainError(
      "INVALID_NAME",
      "PowerTranz amount or currency is invalid.",
    );
  const divisor = 10 ** exponent;
  return Number(amount.amountMinor) / divisor;
}

function amountMatches(
  value: unknown,
  amount: Money,
  exponent: number,
): boolean {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return false;
  const scaled = value * 10 ** exponent;
  return Math.abs(scaled - Number(amount.amountMinor)) < 0.000001;
}

/**
 * The merchant response passes through the cardholder browser and is NOT a signed webhook.
 * It can only trigger a server-to-server /spi/Payment call; the authenticated response is
 * checked again before a caller may record a successful payment.
 */
export class PowerTranzAdapter {
  readonly id = "powertranz";
  private readonly baseUrl: string;
  constructor(
    private readonly config: {
      baseUrl: string;
      merchantId: string;
      merchantPassword: string;
      pageSet: string;
      pageName: string;
      currency: string;
      numericCurrencyCode: string;
      currencyExponent: number;
      fetch?: typeof globalThis.fetch;
      clock?: () => Date;
    },
  ) {
    const base = new URL(config.baseUrl);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !base.pathname.replace(/\/$/, "").endsWith("/Api")
    )
      throw new Error("PowerTranz baseUrl must be an HTTPS /Api endpoint.");
    if (
      !config.merchantId ||
      !config.merchantPassword ||
      !/^PTZ\/[A-Za-z0-9_-]{1,80}$/.test(config.pageSet) ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(config.pageName) ||
      !/^[A-Z]{3}$/.test(config.currency) ||
      !/^\d{3}$/.test(config.numericCurrencyCode) ||
      !Number.isInteger(config.currencyExponent) ||
      config.currencyExponent < 0 ||
      config.currencyExponent > 3
    )
      throw new Error("PowerTranz merchant configuration is invalid.");
    this.baseUrl = `${base.href.replace(/\/$/, "")}/`;
  }

  async beginHostedSale(input: {
    transactionIdentifier: string;
    orderIdentifier: string;
    amount: Money;
    merchantResponseUrl: string;
    threeDSecure: boolean;
  }): Promise<PowerTranzHostedSession> {
    if (
      !guid.test(input.transactionIdentifier) ||
      !safeReference.test(input.orderIdentifier)
    )
      throw new DomainError(
        "INVALID_NAME",
        "PowerTranz transaction references are invalid.",
      );
    const callback = new URL(input.merchantResponseUrl);
    if (
      callback.protocol !== "https:" ||
      callback.username ||
      callback.password ||
      callback.hash
    )
      throw new DomainError(
        "INVALID_NAME",
        "PowerTranz callback must be an HTTPS URL.",
      );
    const amount = validateMoney(
      input.amount,
      this.config.currency,
      this.config.currencyExponent,
    );
    const body = {
      TransactionIdentifier: input.transactionIdentifier,
      TotalAmount: amount,
      CurrencyCode: this.config.numericCurrencyCode,
      ThreeDSecure: input.threeDSecure,
      OrderIdentifier: input.orderIdentifier,
      AddressMatch: false,
      ExtendedData: {
        ...(input.threeDSecure
          ? {
              ThreeDSecure: {
                ChallengeWindowSize: 4,
                ChallengeIndicator: "01",
              },
            }
          : {}),
        HostedPage: {
          PageSet: this.config.pageSet,
          PageName: this.config.pageName,
        },
        MerchantResponseUrl: callback.href,
      },
    };
    const response = object(
      await this.request("spi/Sale", {
        method: "POST",
        body: JSON.stringify(body),
        auth: true,
      }),
    );
    if (
      response.IsoResponseCode !== "SP4" ||
      response.Approved !== false ||
      response.TransactionIdentifier !== input.transactionIdentifier ||
      response.OrderIdentifier !== input.orderIdentifier ||
      response.CurrencyCode !== this.config.numericCurrencyCode ||
      !amountMatches(
        response.TotalAmount,
        input.amount,
        this.config.currencyExponent,
      )
    )
      throw new PowerTranzProtocolError(
        "PowerTranz did not accept the hosted sale as requested.",
      );
    const spiToken = string(response.SpiToken, 512);
    const redirectData = string(response.RedirectData, 65_536);
    return {
      ...input,
      spiToken,
      redirectData,
      expiresAt: new Date(
        (this.config.clock?.() ?? new Date()).getTime() + 5 * 60_000,
      ),
    };
  }

  async completeHostedSale(input: {
    session: PowerTranzHostedSession;
    browserResult: unknown;
  }): Promise<PowerTranzResult> {
    const { session } = input;
    if (
      (this.config.clock?.() ?? new Date()).getTime() >=
      session.expiresAt.getTime()
    )
      throw new PowerTranzProtocolError("PowerTranz SPI token has expired.");
    const callback = object(input.browserResult);
    if (
      callback.TransactionIdentifier !== session.transactionIdentifier ||
      callback.OrderIdentifier !== session.orderIdentifier ||
      callback.SpiToken !== session.spiToken ||
      callback.CurrencyCode !== this.config.numericCurrencyCode ||
      !amountMatches(
        callback.TotalAmount,
        session.amount,
        this.config.currencyExponent,
      )
    )
      throw new PowerTranzProtocolError(
        "PowerTranz browser response does not match the pending sale.",
      );
    if (session.threeDSecure) {
      const risk = object(callback.RiskManagement);
      const threeDSecure = object(risk.ThreeDSecure);
      if (
        callback.IsoResponseCode !== "3D0" ||
        threeDSecure.AuthenticationStatus !== "Y" ||
        !["02", "05"].includes(String(threeDSecure.Eci)) ||
        typeof threeDSecure.Cavv !== "string" ||
        threeDSecure.Cavv.length === 0
      )
        throw new PowerTranzAuthenticationError();
    } else if (callback.IsoResponseCode !== "HP0")
      throw new PowerTranzProtocolError(
        "PowerTranz hosted page did not complete.",
      );
    const result = object(
      await this.request("spi/Payment", {
        method: "POST",
        body: JSON.stringify(session.spiToken),
        auth: false,
      }),
    );
    return this.paymentResult(result, session);
  }

  async queryTransaction(transactionIdentifier: string): Promise<{
    transactionIdentifier: string;
    isoResponseCode: string | null;
    amount: number | null;
    currencyCode: string | null;
  }> {
    if (!guid.test(transactionIdentifier))
      throw new DomainError(
        "INVALID_NAME",
        "PowerTranz transaction identifier is invalid.",
      );
    const response = object(
      await this.request(
        `Transactions/${encodeURIComponent(transactionIdentifier)}`,
        { method: "GET", auth: true },
      ),
    );
    if (response.TransactionIdentifier !== transactionIdentifier)
      throw new PowerTranzProtocolError(
        "PowerTranz query returned another transaction.",
      );
    return {
      transactionIdentifier,
      isoResponseCode:
        typeof response.IsoResponseCode === "string"
          ? response.IsoResponseCode
          : null,
      amount:
        typeof response.TotalAmount === "number" ? response.TotalAmount : null,
      currencyCode:
        typeof response.CurrencyCode === "string"
          ? response.CurrencyCode
          : null,
    };
  }

  async queryApprovedSale(input: {
    transactionIdentifier: string;
    amount: Money;
  }): Promise<boolean> {
    const result = await this.queryTransaction(input.transactionIdentifier);
    return (
      result.isoResponseCode === "00" &&
      result.currencyCode === this.config.numericCurrencyCode &&
      amountMatches(result.amount, input.amount, this.config.currencyExponent)
    );
  }

  private paymentResult(
    result: RecordValue,
    session: PowerTranzHostedSession,
  ): PowerTranzResult {
    if (
      result.TransactionIdentifier !== session.transactionIdentifier ||
      result.OrderIdentifier !== session.orderIdentifier ||
      result.CurrencyCode !== this.config.numericCurrencyCode ||
      !amountMatches(
        result.TotalAmount,
        session.amount,
        this.config.currencyExponent,
      )
    )
      throw new PowerTranzProtocolError(
        "PowerTranz payment response does not match the pending sale.",
      );
    const isoResponseCode = string(result.IsoResponseCode, 16);
    const approved = result.Approved === true && isoResponseCode === "00";
    return {
      transactionIdentifier: session.transactionIdentifier,
      orderIdentifier: session.orderIdentifier,
      approved,
      isoResponseCode,
      amount: session.amount,
      cardBrand:
        typeof result.CardBrand === "string" && result.CardBrand.length <= 32
          ? result.CardBrand
          : null,
      cardLast4:
        typeof result.CardSuffix === "string" &&
        /^\d{4}$/.test(result.CardSuffix)
          ? result.CardSuffix
          : null,
      panToken:
        typeof result.PanToken === "string" && result.PanToken.length <= 255
          ? result.PanToken
          : null,
    };
  }

  private async request(
    path: string,
    input: { method: "POST" | "GET"; body?: string; auth: boolean },
  ): Promise<unknown> {
    const response = await (this.config.fetch ?? fetch)(
      new URL(path, this.baseUrl),
      {
        method: input.method,
        headers: {
          accept: "application/json",
          ...(input.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...(input.auth
            ? {
                "PowerTranz-PowerTranzId": this.config.merchantId,
                "PowerTranz-PowerTranzPassword": this.config.merchantPassword,
              }
            : {}),
        },
        ...(input.body === undefined ? {} : { body: input.body }),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new PowerTranzProtocolError("PowerTranz request failed.");
    const raw = await response.text();
    if (raw.length > 262_144)
      throw new PowerTranzProtocolError("PowerTranz response is too large.");
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new PowerTranzProtocolError("PowerTranz returned invalid JSON.");
    }
  }
}
