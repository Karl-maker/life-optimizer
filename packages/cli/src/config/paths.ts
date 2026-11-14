import path from "node:path";

/** Where the CLI keeps its settings. Pure: everything it needs is passed in. */
export function defaultConfigPath(input: {
  env: Record<string, string | undefined>;
  platform: string;
  home: string;
}): string {
  const { env, platform, home } = input;
  if (env["LIFE_OPTIMIZER_CONFIG"]) return env["LIFE_OPTIMIZER_CONFIG"]; // explicit override: scripts, CI and tests

  const p = platform === "win32" ? path.win32 : path.posix;
  const base =
    platform === "win32"
      ? (env["APPDATA"] ?? p.join(home, "AppData", "Roaming"))
      : env["XDG_CONFIG_HOME"] || p.join(home, ".config");
  return p.join(base, "life-optimizer", "config.json");
}
