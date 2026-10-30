/** A durable integration fact written with the business change, then delivered at-least-once. */
export interface DomainEvent {
  topic: string;
  type: string;
  version: 1;
  occurredAt: Date;
  payload: Record<string, string | number | boolean | null>;
}
export const DOMAIN_EVENT = { userCreated: "user.created" } as const;
