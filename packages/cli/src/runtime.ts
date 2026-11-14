import {
  createAuthorizationService,
  createCore,
  type AuthorizationService,
  type Core,
} from "@edu-service/core";
import { createDatabase, type Database } from "@edu-service/db";
import {
  createAiService,
  createOllamaProvider,
  createOpenAiProvider,
  type AiService,
} from "@edu-service/ai";
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
 * Everything is lazy, so `life-optimizer --help` and `life-optimizer --version` work with no database configured.
 */
export function createRuntime(options: {
  env: Record<string, string | undefined>;
  version: string;
  io: IO;
  configPath: string;
}): Runtime {
  let db: Database | undefined;
  let core: Core | undefined;
  let authorization: AuthorizationService | undefined;
  let ai: AiService | undefined;
  const telemetry = createRuntimeTelemetry(options);

  const getDatabase = (): Database => {
    if (!db) {
      const connectionString = options.env["DATABASE_URL"];
      if (!connectionString) {
        throw new CliError({
          code: "CONFIG",
          message:
            "DATABASE_URL is not set, so life-optimizer cannot reach the database.",
          hint: "Set it, for example: export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/life_optimizer",
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
    }
    return db;
  };

  const getCore = (): Core => {
    if (!core) {
      const database = getDatabase();
      core = createCore({
        users: database.users,
        companies: database.companies,
        lifeLogs: database.lifeLogs,
        transactions: database.transactions,
      });
    }
    return core;
  };

  const getAi = (): AiService => {
    if (!ai) {
      const endpoint = options.env["OLLAMA_ENDPOINT"];
      const timeoutMs = parseOllamaTimeout(options.env["OLLAMA_TIMEOUT_MS"]);
      const openAiApiKey = options.env["OPENAI_API_KEY"]?.trim();
      const preferredProvider = parsePreferredAiProvider(
        options.env["LIFE_OPTIMIZER_AI_PROVIDER"],
      );
      if (preferredProvider === "openai" && !openAiApiKey)
        throw new CliError({
          code: "CONFIG",
          message:
            "OPENAI_API_KEY is required when LIFE_OPTIMIZER_AI_PROVIDER=openai.",
          hint: "Set OPENAI_API_KEY, or choose LIFE_OPTIMIZER_AI_PROVIDER=ollama.",
        });
      ai = createAiService({
        models: getDatabase().aiModels,
        operationLog: {
          info: (name, attributes, correlationId) =>
            telemetry.info(name, attributes, correlationId),
          error: (name, attributes, correlationId) =>
            telemetry.error(name, attributes, correlationId),
        },
        providers: [
          createOllamaProvider({
            ...(endpoint ? { endpoint } : {}),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          }),
          ...(openAiApiKey
            ? [createOpenAiProvider({ apiKey: openAiApiKey })]
            : []),
        ],
      });
    }
    return ai;
  };

  const getAuthorization = (): AuthorizationService => {
    if (!authorization) {
      const database = getDatabase();
      authorization = createAuthorizationService({
        repository: database.authorization,
        transactions: database.authorizationTransactions,
      });
    }
    return authorization;
  };

  return {
    deps: {
      io: options.io,
      env: options.env,
      version: options.version,
      core: getCore,
      authorization: getAuthorization,
      ai: getAi,
      config: createFileConfigStore(options.configPath),
      logger: telemetry,
    },
    async close() {
      await telemetry.flush();
      await db?.close();
    },
  };
}

function parsePreferredAiProvider(
  value: string | undefined,
): "auto" | "ollama" | "openai" {
  const provider = value?.trim() || "auto";
  if (provider === "auto" || provider === "ollama" || provider === "openai")
    return provider;
  throw new CliError({
    code: "CONFIG",
    message: "LIFE_OPTIMIZER_AI_PROVIDER must be auto, ollama, or openai.",
  });
}

function parseOllamaTimeout(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const milliseconds = Number(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 1_000 ||
    milliseconds > 1_800_000
  )
    throw new CliError({
      code: "CONFIG",
      message: "OLLAMA_TIMEOUT_MS must be a whole number from 1000 to 1800000.",
      hint: "Use milliseconds, for example OLLAMA_TIMEOUT_MS=600000 for ten minutes.",
    });
  return milliseconds;
}

function createRuntimeTelemetry(options: {
  env: Record<string, string | undefined>;
  io: IO;
}): Telemetry {
  const sinks: EventSink[] = [];
  if (options.env["LIFE_OPTIMIZER_LOG_JSON"] === "1")
    sinks.push(
      createJsonLinesSink((line: string) => options.io.err.write(line)),
    );
  const filePath = options.env["LIFE_OPTIMIZER_LOG_FILE"];
  if (filePath) sinks.push(createLocalFileSink({ filePath }));
  const endpoint = options.env["LIFE_OPTIMIZER_LOG_HTTP_ENDPOINT"];
  if (endpoint) sinks.push(createHttpSink({ endpoint }));
  return createTelemetry({
    service: "life-optimizer-cli",
    sinks,
    onSinkError: () => undefined,
  });
}
