export const PERMISSIONS = {
  admin: ["access"],
  permissions: ["read", "manage"],
  users: ["read", "create", "update", "delete"],
  companies: ["read", "write", "delete"],
  cms: ["read", "write", "publish", "delete"],
  products: ["read", "write"],
  payments: ["read", "refund"],
  finance: ["read"],
  financial: ["manage", "purchase"],
  audit: ["read"],
  "ai-audits": ["read"],
  "ai-providers": ["read", "write"],
  system: ["read"],
} as const satisfies Record<string, readonly string[]>;

export type PermissionResource = keyof typeof PERMISSIONS;

export type PermissionAction<
  R extends PermissionResource = PermissionResource,
> = (typeof PERMISSIONS)[R][number];

export type Permission = {
  [R in PermissionResource]: `${R}:${PermissionAction<R>}`;
}[PermissionResource];

/** Stable permission catalogue used by role management, API docs and CLI help. */
export const ALL_PERMISSIONS = Object.entries(PERMISSIONS).flatMap(
  ([resource, actions]) =>
    actions.map((action) => `${resource}:${action}` as Permission),
) as readonly Permission[];

export function isPermission(value: unknown): value is Permission {
  if (typeof value !== "string") return false;

  const [resource, action, ...extra] = value.split(":");

  if (!resource || !action || extra.length > 0) return false;

  if (!Object.hasOwn(PERMISSIONS, resource)) return false;

  const actions = (
    PERMISSIONS as Record<string, readonly string[] | undefined>
  )[resource];

  return actions?.includes(action) ?? false;
}

export function parsePermission(value: unknown): Permission {
  if (!isPermission(value)) {
    throw new TypeError(`Invalid permission: ${String(value)}`);
  }

  return value;
}

export function createPermission<R extends PermissionResource>(
  resource: R,
  action: PermissionAction<R>,
): `${R}:${PermissionAction<R>}` {
  return `${resource}:${action}`;
}
