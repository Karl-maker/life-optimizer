import { describe, expect, it } from "vitest";
import { main } from "../../src/main.js";
import { testDeps } from "../helpers.js";

describe("chat command", () => {
  it("creates a session and prints the answer, sources, and token usage", async () => {
    const t = testDeps({
      env: {
        LIFE_OPTIMIZER_AI_PROVIDER: "openai",
        LIFE_OPTIMIZER_AI_MODEL: "gpt-4.1-mini",
      },
    });
    t.agent.createSession.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      userId: t.me!.id,
      timeZone: "America/Port_of_Spain",
    });
    t.agent.send.mockResolvedValue({
      sessionId: "33333333-3333-4333-8333-333333333333",
      text: "You logged a walk.",
      sources: [
        {
          type: "life-log",
          id: "22222222-2222-4222-8222-222222222222",
          title: "2026-11-14 08:00:00 — Walked briskly in the park.",
        },
      ],
      toolUsage: [],
      usage: { inputTokens: 20, outputTokens: 5, costMicrousd: 12_000 },
      budget: {
        limitMicrousd: 5_000_000,
        spentMicrousd: 12_000,
        remainingMicrousd: 4_988_000,
        remainingPercent: 99.76,
        warning: false,
        exhausted: false,
        modelId: "openai-gpt-4.1-mini",
        downgraded: false,
      },
    });

    expect(
      await main(["agent", "chat", "--message", "How was my walk?"], t.deps),
    ).toBe(0);
    expect(t.agent.send).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "openai-gpt-4.1-mini",
        message: "How was my walk?",
      }),
    );
    expect(t.stdout()).toContain("You logged a walk.");
    expect(t.stdout()).toContain("[log:22222222-2222-4222-8222-222222222222]");
    expect(t.stdout()).toContain("Walked briskly in the park.");
    expect(t.stdout()).not.toContain("— exercise");
    expect(t.stdout()).toContain("Tokens: 20 input, 5 output");
    expect(t.stdout()).toContain("$4.9880 of $5.0000");
  });
});
