# `@edu-service/cms`

Localized, feature-aware content for browser pages and mobile screens. Editors work on an auditable CRDT draft; publishing emits a bounded, static JSON projection suitable for S3/CDN delivery under the `cms/` prefix.

## How it works

1. A document is identified by `{ kind: "page" | "screen", key, locale }`. Locales are canonical BCP 47 tags such as `en`, `en-TT`, or `es-419`.
2. `create`, `edit`, `delete`, and `restore` append immutable `CmsChange` batches. Every batch contains the actor ID, correlation ID, logical clock, time, and exact operations. The operation-set CRDT merges concurrent copies by change ID and deterministically replays them, so every node converges without discarding another editor's audit record.
3. `publish` materializes the draft into a scheduled release and writes only the client projection—not editor history—to `cms/pages/<key>/<locale>/releases/<releaseId>.json` or the corresponding `screens` path. With `createObjectStoreCmsPublisher`, the existing S3 adapter performs that write. Storage keys are relative; their HTTP/CDN path begins `/cms/...`.
4. `resolve` tries the caller's ordered locale fallback list, caches all unfiltered releases, selects the newest release where `publishAt <= now < expiresAt`, evaluates feature flags, and removes gated components plus descendants of hidden parents. A release without `expiresAt` remains eligible until a newer active release supersedes it.
5. The resolved payload includes `cacheUntil`, calculated as the earlier of the active release's expiry and the next scheduled release's start. Browser and mobile clients must revalidate no later than that instant.

The draft store is a port because reliable concurrent persistence needs compare/merge semantics. `InMemoryCmsDraftStore` is for tests and local work. A production adapter must load the latest CRDT, merge incoming changes, and durably commit the merged change set. S3 holds published static delivery objects; do not treat a last-writer-wins S3 snapshot as a safe collaborative draft store unless the adapter also preserves immutable changes and handles conditional writes.

## Create, edit, publish, resolve

```ts
const cms = createCmsService({
  drafts,
  publications,
  publisher: createObjectStoreCmsPublisher(s3ObjectStore),
  featureFlags,
  cache, // @edu-service/cache; raw publications only
});

await cms.create({
  identity: { kind: "screen", key: "onboarding/welcome", locale: "en-TT" },
  context: { actorId: editor.id, correlationId: request.id },
  fields: { title: "Welcome" },
  components: [
    {
      id: "continue",
      type: "button",
      parentId: null,
      position: 100,
      props: {
        label: "Continue",
        action: { type: "navigate", target: "profile/setup" },
        backgroundToken: "action.primary",
        textColorToken: "text.on-primary",
      },
      variants: {
        mobile: { size: "full-width" },
        browser: { size: "compact" },
      },
      gate: {
        kind: "flag",
        flagKey: "onboarding.new-flow",
        variants: ["treatment"],
      },
    },
  ],
});

await cms.edit({
  identity: { kind: "screen", key: "onboarding/welcome", locale: "en-TT" },
  context: { actorId: editor.id, correlationId: request.id },
  operations: [
    {
      kind: "set-field",
      field: "analyticsName",
      value: "onboarding_welcome",
    },
  ],
});

await cms.publish({
  identity: {
    kind: "screen",
    key: "onboarding/welcome",
    locale: "en-TT",
  },
  releaseId: "halloween-2026",
  publishAt: new Date("2026-10-31T00:00:00Z"),
  expiresAt: new Date("2026-11-01T00:00:00Z"),
});

const result = await cms.resolve({
  kind: "screen",
  key: "onboarding/welcome",
  locales: [requestedLocale, userLocale, "en"],
  evaluationContext: {
    targetingKey: authenticatedUser.id,
    correlationId: request.id,
    attributes: trustedUserAttributes,
  },
});
```

Deleting creates a CRDT tombstone and keeps the change history; it does not silently erase the audit trail. `unpublish` separately removes the static delivery object. Restoring appends another attributed change.

## Client contract and extension

Components form a bounded tree with stable IDs, parent IDs, integer positions, JSON props, optional platform/responsive variants, and an optional feature policy. `props` can describe text, buttons, images, video, colors, highlights, spacing, actions, accessibility labels, or design-token references. Prefer tokens such as `brand.primary` over raw platform-specific styling so mobile and browser clients can map one document to native controls.

Clients must maintain an allow-list of component `type` values and validate each type's props. Never interpret arbitrary JavaScript, HTML, CSS, URLs, or actions directly from CMS JSON. Unknown types or props should fail safely and emit bounded operational telemetry.

To add a component type:

1. Define its versioned prop contract in the client/shared contract package, including accessibility behavior and safe action/URL handling.
2. Add renderers and contract tests on browser and mobile before editors can publish it.
3. Keep the CMS core generic unless the new behavior needs a universal invariant. Use `variants.mobile`, `variants.browser`, or breakpoint keys for presentation differences.
4. Gate experimental components with `FlagAccessPolicy`. Feature flags select content; they never replace authentication, permissions, ownership, or entitlements.

To add a locale, create a separate document for the canonical tag. Pass fallback order explicitly at resolution. Do not mix translations inside component props or silently machine-translate at request time; separate documents keep revisions, ownership, and publishing independently auditable.

## API and caching guidance

An API route should authenticate first, build trusted flag context, call `resolve`, and return the standard response contract with an ETag derived from `releaseId` and `revision`. Cache the raw localized release list by kind/key/locale, then apply schedule and flags per request. Set the response TTL to no later than `cacheUntil`; clients should persist the same hint and revalidate then. Do not place a personalized filtered response in a shared cache keyed only by page and language. Unless the cache key includes a non-sensitive cohort/variant fingerprint and the response declares correct `Vary` behavior, use `Cache-Control: private, no-store` for personalized responses. Release-specific S3/CDN objects can use long-lived immutable caching because publishing a new schedule creates a new key.
