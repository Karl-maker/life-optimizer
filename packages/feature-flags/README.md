# `@life-optimizer/feature-flags`

Deterministic feature targeting, A/B variants, remote configuration and flag-aware data filtering. The package evaluates local, versioned definitions and requires an exposure recorder; it does not own products, prices, users, HTTP, or persistence.

## Design

- `targetingKey` is the stable user ID. SHA-256 bucketing makes percentage assignments repeatable across processes and sessions without storing assignment state. Keep the flag key, rule ID, salt and targeting key stable to keep the cohort stable. Increasing a cumulative rollout preserves earlier buckets; changing the salt intentionally reshuffles them.
- Definitions use `schemaVersion: 1`, bounded ordered rules and discriminated condition/serve types. The first matching rule wins. An unallocated percentage bucket falls through to the next rule and then the default.
- Every returned decision has already been sent to the required `ExposureRecorder`. Records include user ID, flag/revision, variant, rule, bucket, assignment ID, evaluation ID, time and correlation ID. They deliberately exclude email, IP and other targeting attributes. Production recorders must append durably and deduplicate `evaluationId`; the bundled in-memory recorder is only for tests/local development.
- A flag is not authorization. Evaluate permissions and ownership first. Use flags only to select behavior or further narrow already-authorized data.

This follows the OpenFeature evaluation-context/targeting-key model and Unleash-style deterministic stickiness, while keeping the package provider-neutral. See [OpenFeature evaluation context](https://openfeature.dev/specification/sections/evaluation-context/), [detailed evaluation](https://openfeature.dev/specification/sections/flag-evaluation/), and [Unleash stickiness](https://docs.getunleash.io/concepts/stickiness).

## Define and evaluate a flag

```ts
import {
  createFeatureFlagEvaluator,
  defineFlag,
  type ExposureRecorder,
} from "@life-optimizer/feature-flags";

const catalog = defineFlag({
  schemaVersion: 1,
  key: "catalog.pricing",
  version: "2026-10-31.1",
  enabled: true,
  offVariant: "standard",
  defaultVariant: "standard",
  variants: [
    { key: "standard", value: { priceList: "standard-2026" } },
    { key: "student", value: { priceList: "student-2026" } },
  ],
  rules: [
    {
      id: "tt-student-rollout",
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
            operator: "equals",
            value: "student",
          },
        ],
      },
      serve: {
        kind: "rollout",
        salt: "student-pricing-v1",
        allocations: [
          { variant: "standard", basisPoints: 5_000 },
          { variant: "student", basisPoints: 5_000 },
        ],
      },
    },
  ],
});

declare const recorder: ExposureRecorder; // durable adapter supplied by composition root
const flags = createFeatureFlagEvaluator({ flags: [catalog], recorder });
const decision = await flags.evaluate("catalog.pricing", {
  targetingKey: authenticatedUser.id,
  correlationId: request.id,
  attributes: {
    country: authenticatedUser.country,
    profileType: authenticatedUser.profileType,
    email: authenticatedUser.email,
    contentInterests: authenticatedUser.contentInterests,
    ip: trustedClientIp,
  },
});
```

Only pass attributes obtained from trusted application data. In an API, do not trust a client-supplied country, profile, email, interest, or forwarded IP without the normal authentication/proxy validation. Built-ins support equality, set membership, array containment, exact/configured subdomain email matching, IPv4/IPv6 CIDR matching, Boolean composition and negation. A school email is not universally inferable from `.edu`; configure approved domains, or derive a trusted `isSchoolEmail` profile attribute.

Variant values should normally contain stable references such as a layout key, product ID or price-list ID. Load the actual product/pricing object from its owning package after evaluation, so catalog data is not coupled to flag definitions.

## Filter already-authorized data

Attach policy metadata in the API/adapter instead of adding flag fields to domain records:

```ts
const decisions = await flags.evaluateMany(["catalog.pricing"], context);
const visibleProducts = filterByFlagAccess(products, decisions, (product) =>
  product.id === experimentalProductId
    ? { kind: "flag", flagKey: "catalog.pricing", variants: ["student"] }
    : null,
);
```

Policies require the explicitly allowed variants and compose with `all`, `any`, and `not`. Missing decisions fail closed. This helper narrows an authorized result set; it must never replace ownership, permission, entitlement, or row-level access checks.

## Extend targeting safely

Prefer a normalized profile attribute plus an existing operator. For example, video preference is `contentInterests contains "video"`, while a verified school relationship can be `isSchoolMember equals true`. This keeps rules as data and avoids embedding business queries in the evaluator.

For a genuinely new parameter:

1. Define a bounded `custom` condition with a stable lowercase name and JSON parameters.
2. Register its pure, deterministic evaluator in the composition root through `customConditions`.
3. Add normal, boundary, malformed/missing-value and privacy tests. A missing evaluator is a startup/evaluation error rather than silently granting access.
4. If the operator becomes common, add it to `AttributeCondition`, schema validation and evaluation together, then document it here. Increment `schemaVersion` only for an incompatible definition format.

Custom evaluators must not perform I/O, mutate profiles, read request globals, log attributes, or depend on time. Fetch and normalize needed state before evaluation. Keep definitions reviewed and versioned; changing conditions, weights, rule order or variants can change who sees a feature even when deterministic bucketing remains stable.
