import { createCore, type Core } from "@edu-service/core";
import { createDatabase, type Database } from "@edu-service/db";
import { createFileConfigStore } from "./config/store.js";
import type { Deps } from "./context.js";
import { CliError } from "./errors/cli-error.js";
import type { IO } from "./io/streams.js";
import {
  createHttpSink,
  createJsonLinesSink,
  createLocalFileSink,
  createTelemetry,
  type EventSink,
  type Telemetry,
} from "./observability/logger.js";

export interface Runtime {
  deps: Deps;
  /** Releases the database connection, if one was opened. Call once when the command is done. */
  close(): Promise<void>;
}

/**
 * The composition root: the one place where the real database, core and config file are wired together.
 * Everything is lazy, so `edu-service --help` and `edu-service --version` work with no database configured.
 */
export function createRuntime(options: {
  env: Record<string, string | undefined>;
  version: string;
  io: IO;
  configPath: string;
}): Runtime {
  let db: Database | undefined;
  let core: Core | undefined;
  const telemetry = createRuntimeTelemetry(options);

  const getCore = (): Core => {
    if (!core) {
      const connectionString = options.env["DATABASE_URL"];
      if (!connectionString) {
        throw new CliError({
          code: "CONFIG",
          message: "DATABASE_URL is not set, so edu-service cannot reach the database.",
          hint: "Set it, for example: export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/edu_service",
        });
      }
      const operationLog = {
        info: (
          name: string,
          attributes?: Record<string, string | number | boolean | null>,
          correlationId?: string,
        ) => telemetry.info(name, attributes, correlationId),
        error: (
          name: string,
          attributes?: Record<string, string | number | boolean | null>,
          correlationId?: string,
        ) => telemetry.error(name, attributes, correlationId),
      };
      db = createDatabase({ connectionString, operationLog });
      core = createCore({
        users: db.users,
        companies: db.companies,
        transactions: db.transactions,
        operationLog,
      });
    }
    return core;
  };

  return {
    deps: {
      io: options.io,
      env: options.env,
      version: options.version,
      core: getCore,
      config: createFileConfigStore(options.configPath),
      logger: telemetry,
    },
    async close() {
      await telemetry.flush();
      await db?.close();
    },
  };
}

function createRuntimeTelemetry(options: {
  env: Record<string, string | undefined>;
  io: IO;
}): Telemetry {
  const sinks: EventSink[] = [];
  if (options.env["EDU_SERVICE_LOG_JSON"] === "1")
    sinks.push(createJsonLinesSink((line: string) => options.io.err.write(line)));
  const filePath = options.env["EDU_SERVICE_LOG_FILE"];
  if (filePath) sinks.push(createLocalFileSink({ filePath }));
  const endpoint = options.env["EDU_SERVICE_LOG_HTTP_ENDPOINT"];
  if (endpoint) sinks.push(createHttpSink({ endpoint }));
  return createTelemetry({
    service: "edu-service-cli",
    sinks,
    onSinkError: () => undefined,
  });
}
