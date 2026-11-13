import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const prismaCli = path.join(
  path.dirname(require.resolve("prisma/package.json")),
  "build/index.js",
);

// Prisma loads prisma.config.ts for `generate`, although client generation does not connect to a
// database. CI's Docker build deliberately has no production DATABASE_URL, so use a harmless,
// local-only placeholder for this command alone. Migration commands still require DATABASE_URL.
const result = spawnSync(process.execPath, [prismaCli, "generate"], {
  env: {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ??
      "postgresql://prisma:prisma@localhost:5432/prisma",
  },
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
