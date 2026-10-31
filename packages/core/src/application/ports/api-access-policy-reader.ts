/**
 * Authorization policy is evaluated outside transport code. A deny always wins
 * over an allow; repositories must return only non-expired policies that match
 * the principal and either the concrete endpoint or the global `*` endpoint.
 */
export type ApiAccessDecision =
  | { outcome: "allowed" }
  | { outcome: "blocked"; supportReference?: string }
  | { outcome: "not-configured" };

export interface ApiAccessPolicyReader {
  evaluate(input: {
    principalId: string;
    endpoint: string;
    at: Date;
  }): Promise<ApiAccessDecision>;
}
