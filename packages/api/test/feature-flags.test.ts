import { describe, expect, it } from "vitest";
import {
  createFeatureFlagManagementService,
  InMemoryExposureRecorder,
  type FeatureFlagRepository,
} from "@edu-service/feature-flags";
import { createApiServer } from "../src/index.js";

describe("feature flag routes", () => {
  it("checks the authenticated user's effective flag and protects admin management", async () => {
    const definition = {
      schemaVersion: 1 as const,
      key: "new.reader",
      version: "1",
      enabled: true,
      offVariant: "off",
      defaultVariant: "on",
      variants: [
        { key: "off", value: false },
        { key: "on", value: true },
      ],
      rules: [],
    };
    const repository: FeatureFlagRepository = {
      list: async () => [definition],
      find: async () => definition,
      save: async (value) => value,
      delete: async () => true,
      findOverride: async () => null,
      saveOverride: async (value) => value,
      deleteOverride: async () => true,
    };
    const service = createFeatureFlagManagementService({
      repository,
      recorder: new InMemoryExposureRecorder(),
      audit: { record: async () => undefined },
    });
    const authenticator = {
      authenticate: async () => ({
        id: "00000000-0000-4000-8000-000000000001",
        kind: "bearer" as const,
        permissions: ["user"],
      }),
    };
    const app = await createApiServer({
      featureFlags: { service, authenticator },
    });
    const result = await app.inject({
      method: "GET",
      url: "/feature-flags/new.reader/check",
      headers: { authorization: "Bearer test" },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      flagKey: "new.reader",
      enabled: true,
      value: true,
    });
    const denied = await app.inject({
      method: "GET",
      url: "/admin/feature-flags",
      headers: { authorization: "Bearer test" },
    });
    expect(denied.statusCode).toBe(403);
    await app.close();
  });
});
