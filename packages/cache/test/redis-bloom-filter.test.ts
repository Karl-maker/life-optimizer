import { describe, expect, it, vi } from "vitest";
import { RedisIdentityBloomFilter } from "../src/redis-bloom-filter.js";

describe("RedisIdentityBloomFilter", () => {
  it("reserves once, hashes identifiers, and shares one Redis key across instances", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce("ready")
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    const filter = new RedisIdentityBloomFilter(
      { sendCommand },
      {
        keyPrefix: "edu:identity",
        hmacKey: "a-secure-index-key-with-at-least-32-bytes",
        capacity: 1_000_000,
      },
    );
    await filter.markReady("email");
    await expect(
      filter.mightContain("email", " Person@Example.com "),
    ).resolves.toBe(false);
    await filter.add("email", "person@example.com");

    expect(sendCommand).toHaveBeenCalledTimes(6);
    expect(sendCommand.mock.calls[0]?.[0]).toEqual([
      "BF.RESERVE",
      "edu:identity:email:v1",
      "0.001",
      "1000000",
      "EXPANSION",
      "2",
    ]);
    expect(sendCommand.mock.calls[4]?.[0]).toEqual([
      "BF.EXISTS",
      "edu:identity:email:v1",
      expect.not.stringContaining("person@example.com"),
    ]);
    expect(sendCommand.mock.calls[4]?.[0][2]).toBe(
      sendCommand.mock.calls[5]?.[0][2],
    );
  });

  it("treats an unbackfilled filter as possibly present", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(null);
    const filter = new RedisIdentityBloomFilter(
      { sendCommand },
      {
        keyPrefix: "edu:identity",
        hmacKey: "a-secure-index-key-with-at-least-32-bytes",
        capacity: 10,
      },
    );
    await expect(
      filter.mightContain("email", "existing@example.com"),
    ).resolves.toBe(true);
    expect(sendCommand).not.toHaveBeenCalledWith(
      expect.arrayContaining(["BF.EXISTS"]),
    );
  });

  it("accepts an already-created filter but not unrelated Redis failures", async () => {
    const exists = new RedisIdentityBloomFilter(
      {
        sendCommand: vi
          .fn()
          .mockRejectedValueOnce(new Error("ERR item exists"))
          .mockResolvedValueOnce("ready")
          .mockResolvedValueOnce(0),
      },
      {
        keyPrefix: "edu:identity",
        hmacKey: "a-secure-index-key-with-at-least-32-bytes",
        capacity: 10,
      },
    );
    await expect(
      exists.mightContain("phone", "+1 (868) 555-0100"),
    ).resolves.toBe(false);

    const failed = new RedisIdentityBloomFilter(
      {
        sendCommand: vi.fn().mockRejectedValue(new Error("connection closed")),
      },
      {
        keyPrefix: "edu:identity",
        hmacKey: "a-secure-index-key-with-at-least-32-bytes",
        capacity: 10,
      },
    );
    await expect(failed.mightContain("email", "a@example.com")).rejects.toThrow(
      "connection closed",
    );
  });
});
