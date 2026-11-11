import {
  isPermission,
  type AuthorizationRepository,
  type AuthorizationRole,
  type Permission,
} from "@edu-service/core";
import type { PrismaClient } from "../generated/client.js";

type Client = Pick<
  PrismaClient,
  "authorizationRole" | "authorizationRolePermission" | "userAuthorizationRole"
>;

export class PrismaAuthorizationRepository implements AuthorizationRepository {
  constructor(private readonly prisma: Client) {}

  async listRoles(): Promise<readonly AuthorizationRole[]> {
    const rows = await this.prisma.authorizationRole.findMany({
      include: { permissions: { orderBy: { permission: "asc" } } },
      orderBy: { id: "asc" },
    });
    return rows.map(role);
  }

  async findRole(id: string): Promise<AuthorizationRole | null> {
    const row = await this.prisma.authorizationRole.findUnique({
      where: { id },
      include: { permissions: { orderBy: { permission: "asc" } } },
    });
    return row ? role(row) : null;
  }

  async createRole(input: Omit<AuthorizationRole, "system">) {
    return role(
      await this.prisma.authorizationRole.create({
        data: {
          id: input.id,
          name: input.name,
          description: input.description,
          system: false,
          permissions: {
            create: input.permissions.map((permission) => ({ permission })),
          },
        },
        include: { permissions: { orderBy: { permission: "asc" } } },
      }),
    );
  }

  async replaceRolePermissions(id: string, permissions: readonly Permission[]) {
    const existing = await this.prisma.authorizationRole.findUnique({
      where: { id },
    });
    if (!existing) return null;
    await this.prisma.authorizationRolePermission.deleteMany({
      where: { roleId: id },
    });
    if (permissions.length)
      await this.prisma.authorizationRolePermission.createMany({
        data: permissions.map((permission) => ({ roleId: id, permission })),
      });
    return this.findRole(id);
  }

  async listUserRoles(userId: string) {
    return this.prisma.userAuthorizationRole.findMany({
      where: { userId },
      select: {
        userId: true,
        roleId: true,
        grantedByUserId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { roleId: "asc" }],
    });
  }

  async listUserPermissions(userId: string): Promise<readonly Permission[]> {
    const rows = await this.prisma.userAuthorizationRole.findMany({
      where: { userId },
      select: {
        role: { select: { permissions: { select: { permission: true } } } },
      },
    });
    return [
      ...new Set(
        rows.flatMap((row) =>
          row.role.permissions.map((value) => value.permission),
        ),
      ),
    ]
      .filter(isPermission)
      .sort();
  }

  async assignRole(input: {
    userId: string;
    roleId: string;
    grantedByUserId: string;
    createdAt: Date;
  }) {
    return this.prisma.userAuthorizationRole.upsert({
      where: { userId_roleId: { userId: input.userId, roleId: input.roleId } },
      create: input,
      update: {
        grantedByUserId: input.grantedByUserId,
        createdAt: input.createdAt,
      },
      select: {
        userId: true,
        roleId: true,
        grantedByUserId: true,
        createdAt: true,
      },
    });
  }

  async revokeRole(userId: string, roleId: string): Promise<boolean> {
    const result = await this.prisma.userAuthorizationRole.deleteMany({
      where: { userId, roleId },
    });
    return result.count === 1;
  }

  countRootAdministrators(): Promise<number> {
    return this.prisma.userAuthorizationRole.count({
      where: { roleId: "root-admin" },
    });
  }
}

function role(value: {
  id: string;
  name: string;
  description: string;
  system: boolean;
  permissions: readonly { permission: string }[];
}): AuthorizationRole {
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    system: value.system,
    permissions: value.permissions
      .map((item) => item.permission)
      .filter(isPermission),
  };
}
