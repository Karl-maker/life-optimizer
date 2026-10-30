export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** True only for finite JSON-compatible values (no Date, bigint, undefined, or cycles). */
export function isJsonValue(
  value: unknown,
  seen = new Set<object>(),
): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

export interface JsonSchema {
  type?:
    "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  required?: readonly string[];
  properties?: Readonly<Record<string, JsonSchema>>;
  items?: JsonSchema;
  additionalProperties?: boolean;
  enum?: readonly JsonPrimitive[];
}

/** Intentionally small JSON Schema subset for deterministic structured-model outputs. */
export function validateJson(
  schema: JsonSchema,
  value: unknown,
  path = "$",
): string[] {
  if (!isJsonValue(value)) return [`${path} must be a JSON value`];
  const errors: string[] = [];
  if (schema.type && !matchesType(schema.type, value))
    errors.push(`${path} must be ${schema.type}`);
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value)))
    errors.push(`${path} must be one of the allowed values`);
  if (schema.type === "object" && isObject(value)) {
    for (const key of schema.required ?? [])
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      if (key in value)
        errors.push(...validateJson(child, value[key], `${path}.${key}`));
    if (schema.additionalProperties === false)
      for (const key of Object.keys(value))
        if (!(key in (schema.properties ?? {})))
          errors.push(`${path}.${key} is not allowed`);
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items)
    value.forEach((item, index) =>
      errors.push(...validateJson(schema.items!, item, `${path}[${index}]`)),
    );
  return errors;
}

function isObject(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesType(
  type: NonNullable<JsonSchema["type"]>,
  value: JsonValue,
): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isObject(value);
  if (type === "integer")
    return typeof value === "number" && Number.isInteger(value);
  return typeof value === type;
}
