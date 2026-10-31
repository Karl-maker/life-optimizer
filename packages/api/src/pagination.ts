import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export interface PageRequest {
  limit: number;
  cursor?: string;
}
export interface Page<T> {
  data: readonly T[];
  pagination: { limit: number; nextCursor?: string };
  links: { self: string; next?: string };
}

/**
 * Parses bounded cursor pagination from query parameters. Cursor tokens are
 * opaque to consumers; use a stable DB sort key (for example createdAt + id),
 * never an offset, to prevent pages drifting as new rows are inserted.
 */
export function parsePageRequest(query: Record<string, unknown>): PageRequest {
  const rawLimit = query.limit;
  const limit =
    rawLimit === undefined
      ? DEFAULT_LIMIT
      : typeof rawLimit === "string" && /^\d+$/.test(rawLimit)
        ? Number(rawLimit)
        : Number.NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    throw new PageRequestError(
      `limit must be an integer between 1 and ${MAX_LIMIT}.`,
    );
  const cursor = query.cursor;
  if (
    cursor !== undefined &&
    (typeof cursor !== "string" || cursor.length > 512)
  )
    throw new PageRequestError(
      "cursor must be an opaque string of at most 512 characters.",
    );
  return { limit, ...(cursor === undefined ? {} : { cursor }) };
}

export class PageRequestError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "PageRequestError";
  }
}

/** Encodes a versioned cursor without disclosing its database tuple. */
export function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify({ v: 1, p: value })).toString("base64url");
}

export function decodeCursor(cursor: string): Record<string, string | number> {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { v?: unknown }).v !== 1 ||
      !isScalarMap((parsed as { p?: unknown }).p)
    )
      throw new Error();
    return (parsed as { p: Record<string, string | number> }).p;
  } catch {
    throw new PageRequestError("cursor is invalid or expired.");
  }
}

export function createPage<T>(
  request: FastifyRequest,
  input: {
    data: readonly T[];
    limit: number;
    nextCursor?: string;
  },
): Page<T> {
  const self = request.url;
  const next =
    input.nextCursor === undefined
      ? undefined
      : withCursor(self, input.nextCursor);
  return {
    data: input.data,
    pagination: {
      limit: input.limit,
      ...(input.nextCursor === undefined
        ? {}
        : { nextCursor: input.nextCursor }),
    },
    links: { self, ...(next === undefined ? {} : { next }) },
  };
}

/** Sets RFC 8288 `Link: rel="next"` alongside the uniform JSON envelope. */
export function sendPage<T>(reply: FastifyReply, page: Page<T>): Page<T> {
  if (page.links.next) reply.header("link", `<${page.links.next}>; rel="next"`);
  return page;
}

/** A bounded, non-reversible fingerprint for logs/cache namespaces, never raw input. */
export function safeIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function withCursor(url: string, cursor: string): string {
  const [path, query = ""] = url.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("cursor", cursor);
  return `${path}?${params.toString()}`;
}
function isScalarMap(value: unknown): value is Record<string, string | number> {
  return (
    !!value &&
    typeof value === "object" &&
    Object.values(value).every(
      (item) => typeof item === "string" || typeof item === "number",
    )
  );
}
