import { z } from "zod";
import { defineCommand } from "../../framework/define-command.js";
import { authorizationPrincipal } from "./principal.js";

export default defineCommand({
  name: "role create",
  summary: "Create a least-privilege administrative role",
  effect: "write",
  options: {
    id: { type: "string", description: "Stable lowercase role id" },
    name: { type: "string", description: "Human-readable role name" },
    description: { type: "string", description: "Role purpose and scope" },
    permissions: {
      type: "string",
      description: "Comma-separated permission names",
    },
  },
  input: z.object({
    id: z.string().min(2),
    name: z.string().min(1),
    description: z.string().min(1),
    permissions: z.string().min(1),
  }),
  async run(input, ctx) {
    const { principal, actorSource } = await authorizationPrincipal(ctx);
    return ctx.authorization().createRole(principal, {
      id: input.id,
      name: input.name,
      description: input.description,
      permissions: input.permissions
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      context: {
        correlationId: ctx.invocation.correlationId,
        source: "cli",
        actorSource,
      },
    });
  },
  human: (role) =>
    `Created ${role.name} (${role.id}) with ${role.permissions.length} permissions.`,
});
