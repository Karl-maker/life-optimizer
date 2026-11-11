import { DomainError } from "../../domain/errors/index.js";
import {
  ALL_PERMISSIONS,
  isPermission,
  type Permission,
} from "../../domain/permissions/index.js";
import type { Actor } from "../../domain/actor/index.js";
import {
  ROOT_ADMIN_ROLE_ID,
  type AuthorizationRepository,
  type AuthorizationRole,
  type AuthorizationTransactionRunner,
} from "../ports/authorization-repository.js";
import { AUDIT_ACTION, type AuditContext } from "../audit/audit-event.js";

export interface AuthorizationPrincipal {
  actor: Actor;
  permissions: readonly Permission[];
}

export function createAuthorizationService(options: {
  repository: AuthorizationRepository;
  transactions: AuthorizationTransactionRunner;
  clock?: () => Date;
}) {
  const clock = options.clock ?? (() => new Date());

  return {
    listPermissions(): readonly Permission[] {
      return ALL_PERMISSIONS;
    },
    listRoles(principal: AuthorizationPrincipal) {
      requirePermission(principal, "permissions:read");
      return options.repository.listRoles();
    },
    permissionsForUser(userId: string) {
      return options.repository.listUserPermissions(userId);
    },
    async bootstrapRootAdministrator(input: {
      userId: string;
      context: AuditContext;
    }) {
      return options.transactions.run(async ({ authorization, audit }) => {
        if ((await authorization.countRootAdministrators()) !== 0)
          throw new DomainError(
            "FORBIDDEN",
            "A root administrator already exists; use an audited role grant.",
          );
        const at = clock();
        const assignment = await authorization.assignRole({
          userId: input.userId,
          roleId: ROOT_ADMIN_ROLE_ID,
          grantedByUserId: input.userId,
          createdAt: at,
        });
        await audit.append({
          occurredAt: at,
          companyId: null,
          actor: { kind: "user", userId: input.userId },
          action: AUDIT_ACTION.authorizationRootBootstrapped,
          outcome: "succeeded",
          resource: {
            type: "authorization-role-assignment",
            id: `${input.userId}:${ROOT_ADMIN_ROLE_ID}`,
          },
          context: input.context,
          changes: { roleId: ROOT_ADMIN_ROLE_ID },
        });
        return assignment;
      });
    },
    async createRole(
      principal: AuthorizationPrincipal,
      input: {
        id: string;
        name: string;
        description: string;
        permissions: readonly string[];
        context: AuditContext;
      },
    ): Promise<AuthorizationRole> {
      requirePermission(principal, "permissions:manage");
      assertRoleId(input.id);
      if (input.id === ROOT_ADMIN_ROLE_ID)
        throw new DomainError(
          "FORBIDDEN",
          "The root administrator role is immutable.",
        );
      const permissions = parsePermissions(input.permissions);
      return options.transactions.run(async ({ authorization, audit }) => {
        const role = await authorization.createRole({
          id: input.id,
          name: bounded(input.name, 1, 100, "Role name"),
          description: bounded(input.description, 1, 500, "Role description"),
          permissions,
        });
        await audit.append({
          occurredAt: clock(),
          companyId: null,
          actor: principal.actor,
          action: AUDIT_ACTION.authorizationRoleCreated,
          outcome: "succeeded",
          resource: { type: "authorization-role", id: role.id },
          context: input.context,
          changes: { permissions },
        });
        return role;
      });
    },
    async replaceRolePermissions(
      principal: AuthorizationPrincipal,
      input: {
        roleId: string;
        permissions: readonly string[];
        context: AuditContext;
      },
    ) {
      requirePermission(principal, "permissions:manage");
      if (input.roleId === ROOT_ADMIN_ROLE_ID)
        throw new DomainError(
          "FORBIDDEN",
          "The root administrator role is immutable.",
        );
      const permissions = parsePermissions(input.permissions);
      return options.transactions.run(async ({ authorization, audit }) => {
        const role = await authorization.replaceRolePermissions(
          input.roleId,
          permissions,
        );
        if (!role)
          throw new DomainError(
            "USER_NOT_FOUND",
            "Authorization role not found.",
          );
        await audit.append({
          occurredAt: clock(),
          companyId: null,
          actor: principal.actor,
          action: AUDIT_ACTION.authorizationRolePermissionsReplaced,
          outcome: "succeeded",
          resource: { type: "authorization-role", id: role.id },
          context: input.context,
          changes: { permissions },
        });
        return role;
      });
    },
    async assignRole(
      principal: AuthorizationPrincipal,
      input: { userId: string; roleId: string; context: AuditContext },
    ) {
      requirePermission(principal, "permissions:manage");
      if (input.roleId === ROOT_ADMIN_ROLE_ID)
        await requireRoot(options.repository, actorUserId(principal.actor));
      const grantedByUserId = actorUserId(principal.actor);
      return options.transactions.run(async ({ authorization, audit }) => {
        if (!(await authorization.findRole(input.roleId)))
          throw new DomainError(
            "USER_NOT_FOUND",
            "Authorization role not found.",
          );
        const at = clock();
        const assignment = await authorization.assignRole({
          userId: input.userId,
          roleId: input.roleId,
          grantedByUserId,
          createdAt: at,
        });
        await audit.append({
          occurredAt: at,
          companyId: null,
          actor: principal.actor,
          action: AUDIT_ACTION.authorizationRoleAssigned,
          outcome: "succeeded",
          resource: {
            type: "authorization-role-assignment",
            id: `${input.userId}:${input.roleId}`,
          },
          context: input.context,
          changes: { userId: input.userId, roleId: input.roleId },
        });
        return assignment;
      });
    },
    async revokeRole(
      principal: AuthorizationPrincipal,
      input: { userId: string; roleId: string; context: AuditContext },
    ) {
      requirePermission(principal, "permissions:manage");
      if (input.roleId === ROOT_ADMIN_ROLE_ID) {
        await requireRoot(options.repository, actorUserId(principal.actor));
        if ((await options.repository.countRootAdministrators()) <= 1)
          throw new DomainError(
            "FORBIDDEN",
            "The final root administrator cannot be removed.",
          );
      }
      return options.transactions.run(async ({ authorization, audit }) => {
        const revoked = await authorization.revokeRole(
          input.userId,
          input.roleId,
        );
        if (revoked)
          await audit.append({
            occurredAt: clock(),
            companyId: null,
            actor: principal.actor,
            action: AUDIT_ACTION.authorizationRoleRevoked,
            outcome: "succeeded",
            resource: {
              type: "authorization-role-assignment",
              id: `${input.userId}:${input.roleId}`,
            },
            context: input.context,
            changes: { userId: input.userId, roleId: input.roleId },
          });
        return revoked;
      });
    },
  };
}

export type AuthorizationService = ReturnType<
  typeof createAuthorizationService
>;

function requirePermission(
  principal: AuthorizationPrincipal,
  permission: Permission,
): void {
  if (!principal.permissions.includes(permission))
    throw new DomainError("FORBIDDEN", `Permission ${permission} is required.`);
}

function actorUserId(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.onBehalfOf;
}

async function requireRoot(
  repository: AuthorizationRepository,
  userId: string,
) {
  const roles = await repository.listUserRoles(userId);
  if (!roles.some((role) => role.roleId === ROOT_ADMIN_ROLE_ID))
    throw new DomainError("FORBIDDEN", "A root administrator is required.");
}

function parsePermissions(values: readonly string[]): Permission[] {
  const result = [...new Set(values)];
  if (
    result.length > ALL_PERMISSIONS.length ||
    result.some((value) => !isPermission(value))
  )
    throw new DomainError(
      "INVALID_NAME",
      "Role permissions contain an unsupported value.",
    );
  return result.sort() as Permission[];
}

function assertRoleId(value: string): void {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(value))
    throw new DomainError(
      "INVALID_NAME",
      "Role id must be a lowercase stable key.",
    );
}

function bounded(
  value: string,
  min: number,
  max: number,
  label: string,
): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max)
    throw new DomainError(
      "INVALID_NAME",
      `${label} must be ${min}-${max} characters.`,
    );
  return normalized;
}
