import { describe, expect, it } from "vitest";
import {
  createApiAccessAuthorizer,
  type ApiAccessPolicyReader,
} from "../../src/index.js";

describe("createApiAccessAuthorizer", () => {
  it("passes a stable principal, endpoint, and current time to the policy port", async () => {
    let received: Parameters<ApiAccessPolicyReader["evaluate"]>[0] | undefined;
    const authorizer = createApiAccessAuthorizer({
      async evaluate(input) {
        received = input;
        return { outcome: "allowed" };
      },
    });
    const now = new Date("2026-10-31T12:00:00.000Z");
    await expect(
      authorizer.evaluate({
        principalId: "partner-1",
        endpoint: "/companies",
        at: now,
      }),
    ).resolves.toEqual({ outcome: "allowed" });
    expect(received).toEqual({
      principalId: "partner-1",
      endpoint: "/companies",
      at: now,
    });
  });
});
