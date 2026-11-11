import { describe, expect, it, vi } from "vitest";
import {
  createAuthorizationService,
  type AuditEventDraft,
  type AuthorizationRepository,
  type AuthorizationRole,
  type Permission,
  type UserRoleAssignment,
} from "../../src/index.js";

const user1 = "11111111-1111-4111-8111-111111111111";
const user2 = "22222222-2222-4222-8222-222222222222";
const context = { correlationId: "request-1", source: "api" as const };

function setup() {
  const roles = new Map<string, AuthorizationRole>([
    [
      "root-admin",
      {
        id: "root-admin",
        name: "Root administrator",
        description: "Root",
        system: true,
        permissions: ["permissions:read", "permissions:manage"],
      },
    ],
  ]);
  const assignments = new Map<string, UserRoleAssignment>();
  const key = (userId: string, roleId: string) => `${userId}:${roleId}`;
  const repository: AuthorizationRepository = {
    listRoles: vi.fn(async () => [...roles.values()]),
    findRole: vi.fn(async (id) => roles.get(id) ?? null),
    createRole: vi.fn(async (input) => {
      const role = { ...input, system: false };
      roles.set(role.id, role);
      return role;
    }),
    replaceRolePermissions: vi.fn(async (id, permissions) => {
      const existing = roles.get(id);
      if (!existing) return null;
      const role = { ...existing, permissions };
      roles.set(id, role);
      return role;
    }),
    listUserRoles: vi.fn(async (userId) =>
      [...assignments.values()].filter((value) => value.userId === userId),
    ),
    listUserPermissions: vi.fn(async (userId) => {
      const result = new Set<Permission>();
      for (const assignment of assignments.values())
        if (assignment.userId === userId)
          for (const permission of roles.get(assignment.roleId)?.permissions ??
            [])
            result.add(permission);
      return [...result];
    }),
    assignRole: vi.fn(async (input) => {
      const value = { ...input };
      assignments.set(key(input.userId, input.roleId), value);
      return value;
    }),
    revokeRole: vi.fn(async (userId, roleId) =>
      assignments.delete(key(userId, roleId)),
    ),
    countRootAdministrators: vi.fn(
      async () =>
        [...assignments.values()].filter(
          (value) => value.roleId === "root-admin",
        ).length,
    ),
  };
  const audits: AuditEventDraft[] = [];
  const service = createAuthorizationService({
    repository,
    transactions: {
      run: (work) =>
        work({
          authorization: repository,
          audit: { append: async (event) => void audits.push(event) },
        }),
    },
    clock: () => new Date("2026-11-03T12:00:00Z"),
  });
  return { service, repository, roles, assignments, audits };
}

describe("authorization service", () => {
  it("bootstraps exactly one root administrator and audits it", async () => {
    const env = setup();
    await expect(
      env.service.bootstrapRootAdministrator({ userId: user1, context }),
    ).resolves.toMatchObject({ userId: user1, roleId: "root-admin" });
    await expect(
      env.service.bootstrapRootAdministrator({ userId: user2, context }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(env.audits).toHaveLength(1);
    expect(env.audits[0]?.action).toBe("authorization.root.bootstrapped");
  });

  it("rejects undeclared permissions when creating roles", async () => {
    const env = setup();
    const principal = {
      actor: { kind: "user" as const, userId: user1 },
      permissions: ["permissions:manage" as const],
    };
    await expect(
      env.service.createRole(principal, {
        id: "finance-reader",
        name: "Finance reader",
        description: "Read-only finance access",
        permissions: ["database:all"],
        context,
      }),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
  });

  it("only lets root delegate root and preserves the final root", async () => {
    const env = setup();
    await env.service.bootstrapRootAdministrator({ userId: user1, context });
    const nonRoot = {
      actor: { kind: "user" as const, userId: user2 },
      permissions: ["permissions:manage" as const],
    };
    await expect(
      env.service.assignRole(nonRoot, {
        userId: user2,
        roleId: "root-admin",
        context,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const root = {
      actor: { kind: "user" as const, userId: user1 },
      permissions: ["permissions:manage" as const],
    };
    await env.service.assignRole(root, {
      userId: user2,
      roleId: "root-admin",
      context,
    });
    await expect(
      env.service.revokeRole(root, {
        userId: user1,
        roleId: "root-admin",
        context,
      }),
    ).resolves.toBe(true);
    const root2 = {
      actor: { kind: "user" as const, userId: user2 },
      permissions: ["permissions:manage" as const],
    };
    await expect(
      env.service.revokeRole(root2, {
        userId: user2,
        roleId: "root-admin",
        context,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
