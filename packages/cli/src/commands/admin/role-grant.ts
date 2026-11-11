import { z } from "zod";
import { defineCommand } from "../../framework/define-command.js";
import { authorizationPrincipal } from "./principal.js";

export default defineCommand({
  name: "role grant",
  summary: "Grant an administrative role to a user",
  effect: "write",
  args: [
    { name: "user", description: "User name or id", required: true },
    { name: "role", description: "Role id", required: true },
  ],
  input: z.object({ user: z.string().min(1), role: z.string().min(1) }),
  async run(input, ctx) {
    const user = await ctx.core().users.get(input.user);
    const { principal, actorSource } = await authorizationPrincipal(ctx);
    return ctx.authorization().assignRole(principal, {
      userId: user.id,
      roleId: input.role,
      context: {
        correlationId: ctx.invocation.correlationId,
        source: "cli",
        actorSource,
      },
    });
  },
  human: (assignment) =>
    `Granted ${assignment.roleId} to ${assignment.userId}.`,
});
