# @life-optimizer/db

PostgreSQL persistence for Life Optimizer. This package owns the Prisma schema, generated client, migrations, repositories, and transaction runners.

Consumers should treat it as an adapter package: import `createDatabase()`, compose the returned repositories into application services, and keep Prisma-specific types inside `@life-optimizer/db`.

## Install and configure

Use the compatibility workspace package from another Life Optimizer package:

```ts
import { createDatabase } from "@life-optimizer/db";
```

Local development needs `packages/db/.env`:

```sh
cp packages/db/.env.example packages/db/.env
pnpm db:up
pnpm db:migrate
```

`DATABASE_URL` points at the development database. `TEST_DATABASE_URL` points at a separate database whose name ends in `_test`; the integration suite refuses to run if it is missing or targets the development database.

For deployed environments, run migrations before starting the service:

```sh
pnpm db:deploy
```

## Create a database adapter

`createDatabase()` builds one Prisma client and returns repository and transaction adapters that speak the public ports from the domain packages.

```ts
import { createCore } from "@life-optimizer/core";
import { createDatabase } from "@life-optimizer/db";

const database = createDatabase({
  connectionString: process.env.DATABASE_URL!,
});

const core = createCore({
  users: database.users,
  companies: database.companies,
  lifeLogs: database.lifeLogs,
  transactions: database.transactions,
});

try {
  await database.ping();
  // Use core, financial, auth, email, SMS, notification, or AI services here.
} finally {
  await database.close();
}
```

Call `close()` exactly once when the process shuts down so the PostgreSQL pool is released. Long-running API or worker processes normally create one adapter during startup and share it through the composition root.

## Repository groups

The returned `Database` object exposes adapters for the current package ports:

| Property                                         | Use it with                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `users`, `companies`, `lifeLogs`, `transactions` | `createCore()` and core use cases, including time-zone-safe life-log persistence and search.                                            |
| `authentication`                                 | `createAuthenticationService()` for credentials, sessions, challenges, login audits, devices, consent receipts, and auth outbox events. |
| `apiAccessPolicies`                              | API CORS/client access authorization.                                                                                                   |
| `aiModels`, `aiCatalogTransactions`              | `createAiCatalog()` and AI model catalog registration.                                                                                  |
| `patron`, `patronTransactions`                   | `createPatronService()` for AI budget configuration, credit situations, user profiles, decisions, and credit ledger workflows.          |
| `financial`, `financialTransactions`             | Financial catalog, entitlement, usage, wallet, and grant workflows.                                                                     |
| `billing`, `billingTransactions`                 | Invoice, coupon, payment, refund, credit-note, dunning, and subscription workflows.                                                     |
| `powerTranzSales`                                | PowerTranz sale persistence.                                                                                                            |
| `storePurchases`, `storePurchaseTransactions`    | App-store purchase mapping, grants, notifications, and revocation workflows.                                                            |
| `emails`, `sms`, `notifications`                 | Messaging package repositories.                                                                                                         |

The package exports `PrismaAuthStore` for focused auth tests or custom composition, but normal consumers should prefer `createDatabase()`.

## Transactions, audit, and outbox

Use the transaction runner that belongs to the service you are composing. Core mutations that need durable audit or integration events should run through `database.transactions`; financial and store-purchase workflows have their own transaction runners because they bind a wider set of repositories.

```ts
await database.transactions.run(async ({ companies, audit, events }) => {
  // Call core application logic that accepts these ports.
  // The business write, audit append, and outbox append commit or roll back together.
});
```

Business rules decide what should be audited. The database adapter only persists the `AuditEventDraft` and enforces append-only storage at the PostgreSQL level. Integration events use the transactional outbox: the package writes committed `event_outbox` rows, and a separate worker is responsible for delivery and retries.

Keep these boundaries intact:

- Do not import Prisma types into `@life-optimizer/core` or other domain packages.
- Do not bypass core authorization or ownership checks with direct Prisma calls.
- Do not log request bodies, authorization headers, cookies, provider credentials, XML documents, database URLs, or raw secrets in audit records, outbox payloads, or telemetry.

## Observability

`createDatabase()` accepts an optional `OperationLog` from `@life-optimizer/core`. It is used for operational telemetry around database health checks:

```ts
import { createTelemetry } from "@life-optimizer/observability";
import { createDatabase } from "@life-optimizer/db";

const telemetry = createTelemetry({
  service: "life-optimizer-api",
  sinks: [],
});

const operationLog = {
  info: telemetry.info,
  error: telemetry.error,
};

const database = createDatabase({
  connectionString: process.env.DATABASE_URL!,
  operationLog,
});

await database.ping(); // emits database.ping.succeeded or database.ping.failed
```

Operational events are best-effort diagnostics. They must never change business behavior and must only contain bounded, non-sensitive attributes. Durable audit events are different: they are product evidence for meaningful state changes and are written in the same transaction as the business change.

For a new database-backed workflow:

1. Define the business meaning, permissions, audit action, and application port in the owning domain package.
2. Implement the Prisma repository or transaction runner in `@life-optimizer/db`.
3. Append audit events and outbox events through the ports supplied inside the transaction.
4. Emit operational telemetry only for diagnostics such as ping status, dependency health, timings, and retry outcomes.
5. Add focused integration tests for persistence, rollback behavior, constraints, audit rows, and outbox rows.

See [`docs/observability.md`](../../docs/observability.md) and [`docs/logging.md`](../../docs/logging.md) for the audit and telemetry model.

## Testing

For database changes, run the same path CI uses when local PostgreSQL is available:

```sh
pnpm db:up:test
pnpm db:migrate:test
pnpm --filter @life-optimizer/db test:integration
```

The repository test setup truncates known tables between tests and verifies the connected database is clearly a test database before doing so. Migration changes should also be checked with a clean test database because CI runs PostgreSQL 17 and applies migrations before typechecking, unit tests, integration tests, and the build.

Before handoff for code changes, run:

```sh
pnpm verify
```
