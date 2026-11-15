import type { AuthorizationPrincipal } from "@life-optimizer/core";
import type { Context } from "../../context.js";

export async function authorizationPrincipal(ctx: Context): Promise<{
  principal: AuthorizationPrincipal;
  actorSource: "flag" | "env" | "config";
}> {
  const resolved = await ctx.actor();
  const userId =
    resolved.actor.kind === "user"
      ? resolved.actor.userId
      : resolved.actor.onBehalfOf;
  const permissions = await ctx.authorization().permissionsForUser(userId);
  return {
    principal: { actor: resolved.actor, permissions },
    actorSource: resolved.source,
  };
}
