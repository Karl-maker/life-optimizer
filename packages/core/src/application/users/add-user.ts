import { parseName } from "../../domain/company/index.js";
import type { User } from "../../domain/user/index.js";
import type { OperationLog } from "../ports/operation-log.js";
import type { UserRepository } from "../ports/user-repository.js";

export interface AddUserInput {
  name: string;
  email?: string | undefined;
}

export const addUser =
  (users: UserRepository, operationLog?: OperationLog) =>
  async (input: AddUserInput): Promise<User> => {
    const user = await users.create({
      name: parseName(input.name, "person"),
      email: input.email?.trim().toLowerCase() || null,
    });
    // User creation is the bootstrap path, so it has no acting principal to audit yet.
    operationLog?.info("user.created", {
      userId: user.id,
      hasEmail: user.email !== null,
    });
    return user;
  };
