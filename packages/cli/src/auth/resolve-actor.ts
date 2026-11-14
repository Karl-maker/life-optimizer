import {
  DomainError,
  type Actor,
  type Core,
  type User,
} from "@edu-service/core";
import type { Config } from "../config/store.js";
import { CliError } from "../errors/cli-error.js";

export type ActorSource = "flag" | "env" | "config";

export interface ResolvedActor {
  actor: Actor;
  user: User;
  /** Where the identity came from, so `life-optimizer whoami` can say so (like `gh auth status`). */
  source: ActorSource;
}

export const SOURCE_LABEL: Record<ActorSource, string> = {
  flag: "the --as flag",
  env: "the LIFE_OPTIMIZER_USER environment variable",
  config: "the active user (life-optimizer user use)",
};

/**
 * WHO is running this command? Highest priority first, like the AWS and GitHub CLIs:
 *   1. --as <user>        (this command only)
 *   2. LIFE_OPTIMIZER_USER        (this shell, scripts, CI)
 *   3. the active user    (saved by `life-optimizer user use`)
 * Core never sees any of this: it only receives the resulting Actor.
 */
export async function resolveActor(input: {
  flagAs: string | undefined;
  env: Record<string, string | undefined>;
  config: Config;
  core: () => Core; // lazy: no database is touched unless an identity was actually given
}): Promise<ResolvedActor> {
  const picked = pick(input);
  if (!picked) {
    throw new CliError({
      code: "AUTH_REQUIRED",
      message:
        "No user selected, so life-optimizer does not know who to act as.",
      hint: "Create one with `life-optimizer user add --name <name>`, select it with `life-optimizer user use <name>`, or pass --as <user>.",
    });
  }

  try {
    const user = await input.core().users.get(picked.ref);
    return {
      actor: { kind: "user", userId: user.id },
      user,
      source: picked.source,
    };
  } catch (error) {
    if (error instanceof DomainError && error.code === "USER_NOT_FOUND") {
      throw new CliError({
        code: "AUTH_REQUIRED",
        message: `Cannot act as "${picked.ref}" (from ${SOURCE_LABEL[picked.source]}): ${error.message}`,
        hint: "Run `life-optimizer user list`, then `life-optimizer user use <name>`.",
        cause: error,
      });
    }
    throw error;
  }
}

function pick(input: {
  flagAs: string | undefined;
  env: Record<string, string | undefined>;
  config: Config;
}) {
  const flag = input.flagAs?.trim();
  if (flag) return { ref: flag, source: "flag" as const };
  const env = input.env["LIFE_OPTIMIZER_USER"]?.trim();
  if (env) return { ref: env, source: "env" as const };
  if (input.config.activeUser)
    return { ref: input.config.activeUser, source: "config" as const };
  return undefined;
}
