import { describe, expect, it } from "vitest";
import { executeAgentAction } from "../../src/agent/actions.js";

describe("agent action executor", () => {
  it("runs an approved argv command without a shell and captures bounded output", async () => {
    await expect(
      executeAgentAction(
        {
          kind: "command",
          program: process.execPath,
          arguments: ["-e", "process.stdout.write('approved output')"],
          workingDirectory: null,
          timeoutSeconds: 10,
        },
        { env: { ...process.env }, cwd: process.cwd() },
      ),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: "approved output",
      stderr: "",
      truncated: false,
    });
  });
});
