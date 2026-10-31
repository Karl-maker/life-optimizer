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
  "storage.upload.requested": {
    topic: "storage";
    version: 1;
    payload: {
      key: string;
      contentType: string | null;
      contentLength: number | null;
    };
  };
  "storage.upload.progressed": {
    topic: "storage";
    version: 1;
    payload: { key: string; loaded: number; total: number | null };
  };
  "storage.object.uploaded": {
    topic: "storage";
    version: 1;
    payload: {
      key: string;
      contentType: string | null;
      contentLength: number | null;
    };
  };
  "storage.upload.failed": {
    topic: "storage";
    version: 1;
    payload: { key: string; operation: "direct" | "server" };
  };
  "storage.object.deleted": {
    topic: "storage";
    version: 1;
    payload: { key: string };
  };
  "storage.object.tier.changed": {
    topic: "storage";
    version: 1;
    payload: { key: string; storageTier: string };
  };
}

export type EventType = keyof EventCatalog;
export type EventDefinition<T extends EventType> = EventCatalog[T];

export const EVENT_DEFINITION: {
  readonly [T in EventType]: Pick<EventDefinition<T>, "topic" | "version">;
} = {
  "user.created": { topic: "identity", version: 1 },
  "storage.upload.requested": { topic: "storage", version: 1 },
  "storage.upload.progressed": { topic: "storage", version: 1 },
  "storage.object.uploaded": { topic: "storage", version: 1 },
  "storage.upload.failed": { topic: "storage", version: 1 },
  "storage.object.deleted": { topic: "storage", version: 1 },
  "storage.object.tier.changed": { topic: "storage", version: 1 },
};
