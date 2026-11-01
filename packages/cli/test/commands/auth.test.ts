import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/main.js";
import { testDeps } from "../helpers.js";

afterEach(() => vi.unstubAllGlobals());

describe("CLI authentication", () => {
  it("reads the password through the secret prompt and stores an opaque session", async () => {
    const env = testDeps();
    env.deps.io.readSecret = vi.fn(async () => "correct horse battery staple");
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.body).toBe(
        JSON.stringify({
          email: "person@example.test",
          password: "correct horse battery staple",
          client: "cli",
        }),
      );
      return new Response(
        JSON.stringify({
          token: "opaque-session-token-long-enough",
          expiresAt: "2026-11-30T00:00:00.000Z",
          profile: { name: "Person", email: "person@example.test" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await main(
        [
          "auth",
          "login",
          "--email",
          "person@example.test",
          "--api-url",
          "https://api.example.test",
        ],
        env.deps,
      ),
    ).toBe(0);
    expect(env.config.current()).toMatchObject({
      apiUrl: "https://api.example.test",
      sessionToken: "opaque-session-token-long-enough",
    });
    expect(env.deps.io.readSecret).toHaveBeenCalledWith("Password: ");
    expect(env.stdout()).not.toContain("opaque-session");
  });

  it("keeps the local session when remote logout cannot be confirmed", async () => {
    const env = testDeps({
      config: {
        apiUrl: "https://api.example.test",
        sessionToken: "opaque-session-token-long-enough",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    expect(await main(["auth", "logout"], env.deps)).toBe(6);
    expect(env.config.current().sessionToken).toBe(
      "opaque-session-token-long-enough",
    );
  });
});
