/** Rejects prototype-pollution keys before an adapter passes data to any use case. */
export function assertSafeInput(value: unknown, depth = 0): void {
  if (depth > 20)
    throw new UnsafeInputError("Request nesting exceeds the maximum depth.");
  if (Array.isArray(value)) {
    for (const item of value) assertSafeInput(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor")
      throw new UnsafeInputError(
        "Request contains a prohibited property name.",
      );
    assertSafeInput(item, depth + 1);
  }
}
export class UnsafeInputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "UnsafeInputError";
  }
}
