import type { ApiAccessPolicyReader } from "../ports/api-access-policy-reader.js";

/** A transport-neutral bridge used by HTTP, WebSocket, and SSE adapters. */
export function createApiAccessAuthorizer(reader: ApiAccessPolicyReader) {
  return {
    evaluate(input: { principalId: string; endpoint: string; at?: Date }) {
      return reader.evaluate({ ...input, at: input.at ?? new Date() });
    },
  };
}

export type ApiAccessAuthorizer = ReturnType<typeof createApiAccessAuthorizer>;
