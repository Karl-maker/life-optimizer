import { describe, expect, it, vi } from "vitest";
import { createTwilioSmsAdapter, type SmsConfiguration } from "../src/index.js";

const configuration: SmsConfiguration = {
  id: "primary",
  adapterId: "twilio",
  from: "+15550000000",
  fallbackConfigurationIds: [],
  rateLimitMax: 3,
  rateLimitWindowSeconds: 3600,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("Twilio SMS adapter", () => {
  it("posts an E.164 recipient and message body without exposing credentials", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }),
    );
    const adapter = createTwilioSmsAdapter({
      accountSid: "AC12345678901234567890123456789012",
      authToken: "secret",
      fetch: fetcher,
    });
    await expect(
      adapter.send({
        configuration,
        recipient: "+15551112222",
        body: "Reminder",
      }),
    ).resolves.toEqual({ providerMessageId: "SM123" });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("Messages.json"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
