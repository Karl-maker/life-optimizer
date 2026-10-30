/**
 * The single TypeScript catalog for integration-event contracts. Add one entry
 * here for every new event.
 */
export interface EventCatalog {
  "user.created": {
    topic: "identity";
    version: 1;
    payload: { userId: string; hasEmail: boolean };
  };
}

export type EventType = keyof EventCatalog;
export type EventDefinition<T extends EventType> = EventCatalog[T];

export const EVENT_DEFINITION: {
  readonly [T in EventType]: Pick<EventDefinition<T>, "topic" | "version">;
} = {
  "user.created": { topic: "identity", version: 1 },
};
