import { z } from "zod";
import { defineCommand } from "../../framework/define-command.js";

export default defineCommand({
  name: "admin bootstrap",
  summary: "Assign the first root administrator (one time only)",
  effect: "write",
  args: [{ name: "user", description: "User name or id", required: true }],
  input: z.object({ user: z.string().min(1) }),
  async run(input, ctx) {
    const user = await ctx.core().users.get(input.user);
    const assignment = await ctx.authorization().bootstrapRootAdministrator({
      userId: user.id,
      context: {
        correlationId: ctx.invocation.correlationId,
        source: "cli",
        actorSource: "service",
      },
    });
    return { user, assignment };
  },
  human: ({ user }) =>
    `${user.name} (${user.id}) is now the root administrator. Future root grants require an authenticated root administrator.`,
});
