import type { AuditLog } from "./audit-log.js";
import type { Permission } from "../../domain/permissions/index.js";

export const ROOT_ADMIN_ROLE_ID = "root-admin";

export interface AuthorizationRole {
  id: string;
  name: string;
  description: string;
  system: boolean;
  permissions: readonly Permission[];
}

export interface UserRoleAssignment {
  userId: string;
  roleId: string;
  grantedByUserId: string;
  createdAt: Date;
}

export interface AuthorizationRepository {
  listRoles(): Promise<readonly AuthorizationRole[]>;
  findRole(id: string): Promise<AuthorizationRole | null>;
  createRole(
    input: Omit<AuthorizationRole, "system">,
  ): Promise<AuthorizationRole>;
  replaceRolePermissions(
    roleId: string,
    permissions: readonly Permission[],
  ): Promise<AuthorizationRole | null>;
  listUserRoles(userId: string): Promise<readonly UserRoleAssignment[]>;
  listUserPermissions(userId: string): Promise<readonly Permission[]>;
  assignRole(input: {
    userId: string;
    roleId: string;
    grantedByUserId: string;
    createdAt: Date;
  }): Promise<UserRoleAssignment>;
  revokeRole(userId: string, roleId: string): Promise<boolean>;
  countRootAdministrators(): Promise<number>;
}

export interface AuthorizationTransactionRunner {
  run<T>(
    work: (ports: {
      authorization: AuthorizationRepository;
      audit: AuditLog;
    }) => Promise<T>,
  ): Promise<T>;
}
