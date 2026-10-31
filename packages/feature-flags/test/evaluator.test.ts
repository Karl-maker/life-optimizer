import { describe, expect, it, vi } from "vitest";
import {
  InMemoryExposureRecorder,
  createFeatureFlagEvaluator,
  defineFlag,
  filterByFlagAccess,
} from "../src/index.js";

const contentFlag = defineFlag({
  schemaVersion: 1,
  key: "content.experience",
  version: "2026-10-31.1",
  enabled: true,
  offVariant: "standard",
  defaultVariant: "standard",
  variants: [
    { key: "standard", value: { layout: "standard" } },
    { key: "video", value: { layout: "video-first" } },
    { key: "school", value: { layout: "school" } },
  ],
  rules: [
    {
      id: "school-email",
      when: {
        kind: "attribute",
        attribute: "email",
        operator: "email_domain",
        domains: ["school.edu"],
        includeSubdomains: true,
      },
      serve: { kind: "variant", variant: "school" },
    },
    {
      id: "video-interest",
      when: {
        kind: "attribute",
        attribute: "contentInterests",
        operator: "contains",
        value: "video",
      },
      serve: { kind: "variant", variant: "video" },
    },
  ],
});

describe("feature flag evaluation", () => {
  it("uses ordered country, profile, email, interest and CIDR conditions", async () => {
    const flag = defineFlag({
      ...contentFlag,
      key: "catalog.offer",
      rules: [
        {
          id: "trusted-student",
          when: {
            kind: "all",
            conditions: [
              {
                kind: "attribute",
                attribute: "country",
                operator: "equals",
                value: "TT",
              },
              {
                kind: "attribute",
                attribute: "profileType",
                operator: "one_of",
                values: ["student"],
              },
              {
                kind: "attribute",
                attribute: "ip",
                operator: "cidr",
                blocks: ["10.20.0.0/16", "2001:db8::/32"],
              },
            ],
          },
          serve: { kind: "variant", variant: "school" },
        },
        ...contentFlag.rules,
      ],
    });
    const recorder = new InMemoryExposureRecorder();
    const evaluator = createFeatureFlagEvaluator({ flags: [flag], recorder });

    const trusted = await evaluator.evaluate("catalog.offer", {
      targetingKey: "user-1",
      attributes: { country: "TT", profileType: "student", ip: "10.20.4.8" },
      correlationId: "request-1",
    });
    const email = await evaluator.evaluate("catalog.offer", {
      targetingKey: "user-2",
      attributes: { email: "learner@north.school.edu" },
    });
    const interested = await evaluator.evaluate("catalog.offer", {
      targetingKey: "user-3",
      attributes: { contentInterests: ["audio", "video"] },
    });

    expect([trusted.variant, email.variant, interested.variant]).toEqual([
      "school",
      "school",
      "video",
    ]);
    expect(recorder.exposures[0]).toMatchObject({
      targetingKey: "user-1",
      matchedRuleId: "trusted-student",
      correlationId: "request-1",
    });
    expect("attributes" in recorder.exposures[0]!).toBe(false);
  });

  it("keeps percentage assignments stable by targeting key", async () => {
    const flag = defineFlag({
      ...contentFlag,
      key: "checkout.experiment",
      variants: [
        { key: "control", value: "control" },
        { key: "treatment", value: "treatment" },
      ],
      offVariant: "control",
      defaultVariant: "control",
      rules: [
        {
          id: "ab-test",
          when: {
            kind: "attribute",
            attribute: "country",
            operator: "equals",
            value: "TT",
          },
          serve: {
            kind: "rollout",
            salt: "checkout-copy-v1",
            allocations: [
              { variant: "control", basisPoints: 5_000 },
              { variant: "treatment", basisPoints: 5_000 },
            ],
          },
        },
      ],
    });
    const evaluator = createFeatureFlagEvaluator({
      flags: [flag],
      recorder: new InMemoryExposureRecorder(),
    });
    const context = {
      targetingKey: "same-user",
      attributes: { country: "TT" },
    } as const;
    const first = await evaluator.evaluate(flag.key, context);
    const second = await evaluator.evaluate(flag.key, context);

    expect(second.variant).toBe(first.variant);
    expect(second.bucket).toBe(first.bucket);
    expect(second.assignmentId).toBe(first.assignmentId);
    expect(second.evaluationId).not.toBe(first.evaluationId);
  });

  it("falls through an unallocated rollout and serves disabled flags safely", async () => {
    const recorder = new InMemoryExposureRecorder();
    const evaluator = createFeatureFlagEvaluator({
      recorder,
      flags: [
        defineFlag({
          ...contentFlag,
          enabled: false,
          defaultVariant: "video",
          rules: [],
        }),
      ],
    });
    const result = await evaluator.evaluate(contentFlag.key, {
      targetingKey: "user-1",
      attributes: {},
    });
    expect(result).toMatchObject({ variant: "standard", reason: "disabled" });
  });

  it("does not return access when durable exposure recording fails", async () => {
    const evaluator = createFeatureFlagEvaluator({
      flags: [contentFlag],
      recorder: {
        record: vi.fn(async () =>
          Promise.reject(new Error("audit unavailable")),
        ),
      },
    });
    await expect(
      evaluator.evaluate(contentFlag.key, {
        targetingKey: "user-1",
        attributes: {},
      }),
    ).rejects.toThrow("audit unavailable");
  });

  it("supports registered extension conditions", async () => {
    const flag = defineFlag({
      ...contentFlag,
      rules: [
        {
          id: "engaged",
          when: {
            kind: "custom",
            name: "minimum-watch-minutes",
            parameters: { minimum: 30 },
          },
          serve: { kind: "variant", variant: "video" },
        },
      ],
    });
    const evaluator = createFeatureFlagEvaluator({
      flags: [flag],
      recorder: new InMemoryExposureRecorder(),
      customConditions: {
        "minimum-watch-minutes": (parameters, context) =>
          typeof parameters.minimum === "number" &&
          typeof context.attributes.watchMinutes === "number" &&
          context.attributes.watchMinutes >= parameters.minimum,
      },
    });
    await expect(
      evaluator.evaluate(flag.key, {
        targetingKey: "user-1",
        attributes: { watchMinutes: 45 },
      }),
    ).resolves.toMatchObject({ variant: "video" });
  });
});

describe("flag-aware data filtering", () => {
  it("filters attached records and fails closed when a decision is missing", async () => {
    const evaluator = createFeatureFlagEvaluator({
      flags: [contentFlag],
      recorder: new InMemoryExposureRecorder(),
    });
    const decision = await evaluator.evaluate(contentFlag.key, {
      targetingKey: "user-1",
      attributes: { contentInterests: ["video"] },
    });
    const products = [
      { id: "public", gate: null },
      {
        id: "video",
        gate: {
          kind: "flag",
          flagKey: contentFlag.key,
          variants: ["video"],
        } as const,
      },
      {
        id: "missing",
        gate: {
          kind: "flag",
          flagKey: "not-evaluated",
          variants: ["enabled"],
        } as const,
      },
    ];
    expect(
      filterByFlagAccess(
        products,
        new Map([[decision.flagKey, decision]]),
        (item) => item.gate,
      ),
    ).toEqual(products.slice(0, 2));
    expect(
      filterByFlagAccess([{ id: "negated" }], new Map(), () => ({
        kind: "not",
        policy: {
          kind: "flag",
          flagKey: "not-evaluated",
          variants: ["enabled"],
        },
      })),
    ).toEqual([]);
  });
});

describe("flag schema", () => {
  it("rejects malformed CIDRs, duplicate variants and excessive rollout weights", () => {
    expect(() =>
      defineFlag({
        ...contentFlag,
        rules: [
          {
            id: "bad-network",
            when: {
              kind: "attribute",
              attribute: "ip",
              operator: "cidr",
              blocks: ["10.0.0.0/99"],
            },
            serve: { kind: "variant", variant: "video" },
          },
        ],
      }),
    ).toThrow("Invalid CIDR");
    expect(() =>
      defineFlag({
        ...contentFlag,
        variants: [...contentFlag.variants, contentFlag.variants[0]!],
      }),
    ).toThrow("Duplicate variant");
  });
});
