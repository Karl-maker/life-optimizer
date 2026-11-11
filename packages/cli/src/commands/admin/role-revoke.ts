import { z } from "zod";
import { defineCommand } from "../../framework/define-command.js";
import { authorizationPrincipal } from "./principal.js";

export default defineCommand({
  name: "role revoke",
  summary: "Revoke an administrative role from a user",
  effect: "write",
  args: [
    { name: "user", description: "User name or id", required: true },
    { name: "role", description: "Role id", required: true },
  ],
  input: z.object({ user: z.string().min(1), role: z.string().min(1) }),
  async run(input, ctx) {
    const user = await ctx.core().users.get(input.user);
    const { principal, actorSource } = await authorizationPrincipal(ctx);
    const revoked = await ctx.authorization().revokeRole(principal, {
      userId: user.id,
      roleId: input.role,
      context: {
        correlationId: ctx.invocation.correlationId,
        source: "cli",
        actorSource,
      },
    });
    return { userId: user.id, roleId: input.role, revoked };
  },
  human: (result) =>
    result.revoked
      ? `Revoked ${result.roleId} from ${result.userId}.`
      : `No ${result.roleId} assignment existed for ${result.userId}.`,
});
