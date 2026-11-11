import { z } from "zod";
import { defineCommand } from "../../framework/define-command.js";
import { renderTable } from "../../output/table.js";
import { authorizationPrincipal } from "./principal.js";

export default defineCommand({
  name: "role list",
  summary: "List administrative roles and permissions",
  effect: "read",
  input: z.object({}),
  async run(_input, ctx) {
    const { principal } = await authorizationPrincipal(ctx);
    return ctx.authorization().listRoles(principal);
  },
  human: (roles) =>
    renderTable(
      ["ROLE", "NAME", "SYSTEM", "PERMISSIONS"],
      roles.map((role) => [
        role.id,
        role.name,
        role.system ? "yes" : "no",
        role.permissions.join(", "),
      ]),
    ),
});
