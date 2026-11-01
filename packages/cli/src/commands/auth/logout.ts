import { z } from "zod";
import { CliError } from "../../errors/cli-error.js";
import { defineCommand } from "../../framework/define-command.js";

export default defineCommand({
  name: "auth logout",
  summary: "Revoke the current CLI session",
  effect: "write",
  input: z.object({}),
  async run(_input, ctx) {
    if (!ctx.config.apiUrl || !ctx.config.sessionToken)
      throw new CliError({
        code: "AUTH_REQUIRED",
        message: "The CLI is not signed in.",
      });
    let endpoint: URL;
    try {
      endpoint = new URL(ctx.config.apiUrl);
    } catch {
      throw new CliError({
        code: "CONFIG",
        message: "The configured API URL is invalid.",
      });
    }
    let response: Response;
    try {
      response = await fetch(new URL("/v1/auth/logout", endpoint), {
        method: "POST",
        headers: {
          authorization: `Bearer ${ctx.config.sessionToken}`,
          "x-client-platform": "cli",
        },
      });
    } catch (cause) {
      throw new CliError({
        code: "UNAVAILABLE",
        message:
          "The authentication service is unavailable; the local session was kept so logout can be retried.",
        retryable: true,
        cause,
      });
    }
    if (!response.ok && response.status !== 401)
      throw new CliError({
        code: "UNAVAILABLE",
        message: `Logout failed with status ${response.status}; the local session was kept.`,
      });
    await ctx.configStore.update({ sessionToken: undefined });
    return { signedOut: true };
  },
  human: () => "Signed out.",
});
