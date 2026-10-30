import { parseName } from "../../domain/company/index.js";
import type { User } from "../../domain/user/index.js";
import type { OperationLog } from "../ports/operation-log.js";
import type { TransactionRunner } from "../ports/transaction-runner.js";
import { DOMAIN_EVENT } from "../events/domain-event.js";

export interface AddUserInput {
  name: string;
  email?: string | undefined;
}

export const addUser =
  (
    transactions: TransactionRunner,
    operationLog?: OperationLog,
    clock: () => Date = () => new Date(),
  ) =>
  async (input: AddUserInput): Promise<User> => {
    const name = parseName(input.name, "person");
    const email = input.email?.trim().toLowerCase() || null;
    const user = await transactions.run(async ({ users, events }) => {
      const created = await users.create({
        name,
        email,
      });
      await events.append({
        topic: "identity",
        type: DOMAIN_EVENT.userCreated,
        version: 1,
        occurredAt: clock(),
        payload: { userId: created.id, hasEmail: created.email !== null },
      });
      return created;
    });
    // User creation is the bootstrap path, so it has no acting principal to audit yet.
    operationLog?.info("user.created", {
      userId: user.id,
      hasEmail: user.email !== null,
    });
    return user;
  };
