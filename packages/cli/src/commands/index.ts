import type { AnyCommand } from "../framework/define-command.js";
import userAdd from "./user/add.js";
import userList from "./user/list.js";
import userUse from "./user/use.js";
import whoami from "./whoami.js";
import authLogin from "./auth/login.js";
import authLogout from "./auth/logout.js";
import adminBootstrap from "./admin/bootstrap.js";
import adminRoleList from "./admin/role-list.js";
import adminRoleCreate from "./admin/role-create.js";
import adminRoleGrant from "./admin/role-grant.js";
import adminRoleRevoke from "./admin/role-revoke.js";
import lifeLogAdd from "./life-log/add.js";
import lifeLogList from "./life-log/list.js";
import lifeLogSearch from "./life-log/search.js";
import lifeLogImport from "./life-log/import.js";
import lifeLogAsk from "./life-log/ask.js";
import metadataAdd from "./metadata/add.js";

// The command registry: the one list of everything `life-optimizer` can do. Help, parsing and tests all read it.
export const commands: readonly AnyCommand[] = [
  authLogin,
  authLogout,
  adminBootstrap,
  adminRoleList,
  adminRoleCreate,
  adminRoleGrant,
  adminRoleRevoke,
  userAdd,
  userList,
  userUse,
  whoami,
  lifeLogAdd,
  lifeLogList,
  lifeLogSearch,
  lifeLogImport,
  lifeLogAsk,
  metadataAdd,
];

/** Fails at startup, not in front of a user, if the registry is inconsistent. */
export function assertValidRegistry(list: readonly AnyCommand[]): void {
  const seen = new Set<string>();
  for (const c of list) {
    if (seen.has(c.name))
      throw new Error(`Duplicate command name "${c.name}".`);
    seen.add(c.name);
    if (!c.summary.trim())
      throw new Error(`Command "${c.name}" has no summary.`);
    for (const reserved of ["json", "as", "debug", "help"]) {
      if (c.options && reserved in c.options)
        throw new Error(
          `Command "${c.name}" redefines the global option --${reserved}.`,
        );
    }
    const shorts = Object.values(c.options ?? {}).flatMap((o) =>
      o.short ? [o.short] : [],
    );
    if (new Set(shorts).size !== shorts.length || shorts.includes("h")) {
      throw new Error(`Command "${c.name}" has clashing short options.`);
    }
  }
}

assertValidRegistry(commands);
