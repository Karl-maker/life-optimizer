import type {
  AgentActionRequest,
  AgentActionResult,
} from "@life-optimizer/agent";
import { spawn } from "node:child_process";

const MAX_OUTPUT_CHARS = 20_000;

/** Executes an already-approved action without a shell and returns bounded output. */
export async function executeAgentAction(
  action: AgentActionRequest,
  options: { env: Record<string, string | undefined>; cwd: string },
): Promise<AgentActionResult> {
  const command = action.kind === "command" ? action.program : process.execPath;
  const args =
    action.kind === "command"
      ? [...action.arguments]
      : [...process.execArgv, process.argv[1]!, ...action.arguments];
  const cwd =
    action.kind === "command"
      ? (action.workingDirectory ?? options.cwd)
      : options.cwd;
  return run({
    command,
    args,
    cwd,
    env: options.env,
    timeoutMs: action.timeoutSeconds * 1_000,
  });
}

async function run(input: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
}): Promise<AgentActionResult> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    const append = (current: string, chunk: Buffer | string) => {
      const next = current + chunk.toString();
      if (next.length <= MAX_OUTPUT_CHARS) return next;
      truncated = true;
      return next.slice(0, MAX_OUTPUT_CHARS);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      stderr = append(stderr, error.message);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut)
        stderr = append(
          stderr,
          `${stderr ? "\n" : ""}Command timed out after ${input.timeoutMs / 1_000} seconds.`,
        );
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr,
        truncated,
      });
    });
  });
}
