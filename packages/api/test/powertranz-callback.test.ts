import { describe, expect, it } from "vitest";
import { createApiServer } from "../src/index.js";

describe("PowerTranz browser return", () => {
  it("parses one bounded Response field and returns only settlement status", async () => {
    const seen: unknown[] = [];
    const app = await createApiServer({
      powerTranzCallback: {
        checkout: {
          complete: async (request) => {
            seen.push(request.browserResult);
            return { status: "completed" };
          },
        },
      },
    });
    const payload = new URLSearchParams({
      Response: JSON.stringify({
        SpiToken: "secret-token",
        IsoResponseCode: "3D0",
      }),
    }).toString();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/powertranz",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "completed" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(seen).toEqual([
      { SpiToken: "secret-token", IsoResponseCode: "3D0" },
    ]);
    const openapi = (
      await app.inject({ method: "GET", url: "/openapi.json" })
    ).json();
    expect(openapi.paths["/webhooks/powertranz"]).toBeDefined();
    await app.close();
  });
  it("rejects extra or repeated fields before payment handling", async () => {
    let calls = 0;
    const app = await createApiServer({
      powerTranzCallback: {
        checkout: {
          complete: async () => {
            calls++;
            return { status: "completed" };
          },
        },
      },
    });
    for (const payload of [
      "Response=%7B%7D&Response=%7B%7D",
      "Response=%7B%7D&other=1",
      "Response=broken-json",
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/powertranz",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(calls).toBe(0);
    await app.close();
  });
});
