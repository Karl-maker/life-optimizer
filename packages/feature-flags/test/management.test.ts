import { describe, expect, it, vi } from "vitest";
import {
  InMemoryExposureRecorder,
  createFeatureFlagManagementService,
  type FeatureFlagRepository,
  type FlagDefinition,
} from "../src/index.js";

const flag: FlagDefinition = {
  schemaVersion: 1,
  key: "new.reader",
  version: "1",
  enabled: true,
  offVariant: "off",
  defaultVariant: "on",
  variants: [
    { key: "off", value: false },
    { key: "on", value: { layout: "reader-v2" } },
  ],
  rules: [],
};

describe("feature flag management", () => {
  it("applies a user override before the global definition and records exposure", async () => {
    const flags = new Map([[flag.key, flag]]);
    const overrides = new Map<
      string,
      {
        flagKey: string;
        userId: string;
        enabled: boolean;
        variantKey: string | null;
      }
    >();
    const repository: FeatureFlagRepository = {
      list: async () => [...flags.values()],
      find: async (key) => flags.get(key) ?? null,
      save: async (value) => (flags.set(value.key, value), value),
      delete: async (key) => flags.delete(key),
      findOverride: async (key, userId) =>
        overrides.get(`${key}:${userId}`) ?? null,
      saveOverride: async (value) => (
        overrides.set(`${value.flagKey}:${value.userId}`, value),
        value
      ),
      deleteOverride: async (key, userId) =>
        overrides.delete(`${key}:${userId}`),
    };
    const recorder = new InMemoryExposureRecorder();
    const audit = { record: vi.fn(async () => undefined) };
    const service = createFeatureFlagManagementService({
      repository,
      recorder,
      audit,
    });
    await service.setOverride({
      flagKey: flag.key,
      userId: "user-1",
      enabled: false,
      variantKey: null,
      actorId: "admin-1",
      correlationId: "request-1",
    });
    const decision = await service.evaluate(flag.key, {
      targetingKey: "user-1",
      attributes: {},
    });
    expect(decision).toMatchObject({
      variant: "off",
      value: false,
      matchedRuleId: "user-override",
    });
    expect(recorder.exposures).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "override_set", userId: "user-1" }),
    );
  });
});
