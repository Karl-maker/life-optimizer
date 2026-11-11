import { describe, expect, it, vi } from "vitest";
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
    const deleteOverride = vi.fn(async () => true);
    const repository: FeatureFlagRepository = {
      list: async () => [definition],
      find: async (key) => (key === definition.key ? definition : null),
      save: async (value) => value,
      delete: async () => true,
      findOverride: async () => null,
      saveOverride: async (value) => value,
      deleteOverride,
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
        permissions: ["user", "feature-flags:manage"],
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
    const value = await app.inject({
      method: "GET",
      url: "/feature-flags/new.reader",
      headers: { authorization: "Bearer test" },
    });
    expect(value.statusCode).toBe(200);
    expect(value.json()).toMatchObject({
      flagKey: "new.reader",
      enabled: true,
      value: true,
    });
    const missing = await app.inject({
      method: "GET",
      url: "/feature-flags/missing.flag",
      headers: { authorization: "Bearer test" },
    });
    expect(missing.statusCode).toBe(404);
    const removed = await app.inject({
      method: "DELETE",
      url: "/admin/feature-flags/new.reader/users/00000000-0000-4000-8000-000000000002",
      headers: { authorization: "Bearer test" },
    });
    expect(removed.statusCode).toBe(204);
    expect(deleteOverride).toHaveBeenCalledWith(
      "new.reader",
      "00000000-0000-4000-8000-000000000002",
    );
    await app.close();
  });
});
