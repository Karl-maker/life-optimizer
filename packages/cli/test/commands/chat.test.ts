import { describe, expect, it, vi } from "vitest";
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
    expect(t.stdout()).toContain("Usage · 20 input · 5 output · $0.0120");
    expect(t.stdout()).toContain("$4.9880 of $5.0000");
  });

  it("spaces and colors interactive output and requires an explicit yes", async () => {
    const t = testDeps();
    t.deps.io.interactive = true;
    t.deps.io.colorEnabled = true;
    const answers = ["Run a safe command", "yes", "/exit"];
    t.deps.io.readLine = vi.fn(async (prompt: string) => {
      t.deps.io.out.write(prompt);
      return answers.shift() ?? null;
    });
    t.agent.createSession.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      userId: t.me!.id,
      timeZone: "America/Port_of_Spain",
    });
    t.agent.send.mockImplementation(async (input) => {
      input.onToolEvent?.({ name: "run_command", status: "running" });
      const approved = await input.approveAction?.({
        kind: "command",
        program: "node",
        arguments: ["--version"],
        workingDirectory: null,
        timeoutSeconds: 10,
      });
      expect(approved).toBe(true);
      input.onToolEvent?.({ name: "run_command", status: "succeeded" });
      return {
        sessionId: "33333333-3333-4333-8333-333333333333",
        text: "Command completed.",
        sources: [],
        toolUsage: [],
        usage: { inputTokens: 3, outputTokens: 2, costMicrousd: 1 },
      };
    });

    expect(await main(["agent", "chat"], t.deps)).toBe(0);
    expect(t.stdout()).toContain("\u001b[1;36mLife Optimizer Agent\u001b[0m");
    expect(t.stdout()).toContain("Permission required");
    expect(t.stdout()).toContain("Allow this action once? [y/N]");
    expect(t.stdout()).toContain("Approved once.");
    expect(t.stdout()).toContain("\n\n");
    expect(t.stderr()).toContain("Tool · run_command · running");
    expect(t.stderr()).toContain("Tool · run_command · succeeded");
  });
});
