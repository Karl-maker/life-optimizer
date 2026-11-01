import { createCache, InMemoryCacheStore } from "@edu-service/cache";
import {
  createFeatureFlagEvaluator,
  defineFlag,
  InMemoryExposureRecorder,
} from "@edu-service/feature-flags";
import { describe, expect, it, vi } from "vitest";
import {
  createCmsDocument,
  createCmsService,
  createObjectStoreCmsPublisher,
  editCmsDocument,
  InMemoryCmsDraftStore,
  InMemoryCmsPublicationStore,
  materializeCmsDocument,
  mergeCmsDocuments,
} from "../src/index.js";
import type {
  CmsChangeContext,
  CmsComponent,
  CmsIdentity,
} from "../src/index.js";

const identity: CmsIdentity = { kind: "page", key: "home", locale: "en-tt" };
const editor: CmsChangeContext = {
  actorId: "user-editor",
  correlationId: "request-1",
};

function flags() {
  return createFeatureFlagEvaluator({
    recorder: new InMemoryExposureRecorder(),
    flags: [
      defineFlag({
        schemaVersion: 1,
        key: "home.hero",
        version: "1",
        enabled: true,
        offVariant: "standard",
        defaultVariant: "standard",
        variants: [
          { key: "standard", value: null },
          { key: "video", value: null },
        ],
        rules: [
          {
            id: "video-users",
            when: {
              kind: "attribute",
              attribute: "interests",
              operator: "contains",
              value: "video",
            },
            serve: { kind: "variant", variant: "video" },
          },
        ],
      }),
    ],
  });
}

function components(): CmsComponent[] {
  return [
    {
      id: "hero",
      type: "container",
      parentId: null,
      position: 100,
      props: { backgroundToken: "brand.primary" },
    },
    {
      id: "hero-title",
      type: "text",
      parentId: "hero",
      position: 100,
      props: { text: "Learn your way", colorToken: "text.on-brand" },
    },
    {
      id: "video-button",
      type: "button",
      parentId: "hero",
      position: 200,
      props: {
        label: "Watch",
        action: { type: "navigate", target: "/videos" },
      },
      variants: {
        mobile: { size: "full-width" },
        browser: { size: "compact" },
      },
      gate: { kind: "flag", flagKey: "home.hero", variants: ["video"] },
    },
  ];
}

describe("CMS editing", () => {
  it("creates, edits, deletes and restores with actor-attributed changes", async () => {
    const drafts = new InMemoryCmsDraftStore();
    const publications = new InMemoryCmsPublicationStore();
    const cms = createCmsService({
      drafts,
      publications,
      publisher: publications,
      featureFlags: flags(),
      now: () => new Date("2026-10-31T12:00:00.000Z"),
    });
    const created = await cms.create({
      identity,
      context: editor,
      fields: { title: "Home" },
      components: components(),
    });
    expect(created.identity.locale).toBe("en-TT");
    expect(created.components).toHaveLength(3);

    const edited = await cms.edit({
      identity,
      context: { actorId: "user-designer", correlationId: "request-2" },
      operations: [
        {
          kind: "upsert-component",
          component: { ...components()[1]!, props: { text: "Learn together" } },
        },
      ],
    });
    expect(
      edited.components.find((item) => item.id === "hero-title")?.props,
    ).toEqual({
      text: "Learn together",
    });
    const stored = await drafts.get({ ...identity, locale: "en-TT" });
    expect(stored?.changes.at(-1)).toMatchObject({
      actorId: "user-designer",
      correlationId: "request-2",
      operations: [{ kind: "upsert-component" }],
    });
    await expect(cms.delete(identity, editor)).resolves.toMatchObject({
      deleted: true,
    });
    await expect(cms.publish({ identity })).rejects.toThrow("Deleted");
    await expect(cms.restore(identity, editor)).resolves.toMatchObject({
      deleted: false,
    });
  });

  it("merges concurrent changes deterministically without losing either audit record", () => {
    const base = createCmsDocument({
      identity,
      context: editor,
      fields: { title: "Home" },
      now: new Date("2026-10-31T10:00:00.000Z"),
      changeId: "base",
    });
    const left = editCmsDocument({
      document: base,
      context: { actorId: "alice", correlationId: "a" },
      operations: [{ kind: "set-field", field: "title", value: "Alice title" }],
      now: new Date("2026-10-31T11:00:00.000Z"),
      changeId: "alice-1",
    }).document;
    const right = editCmsDocument({
      document: base,
      context: { actorId: "bob", correlationId: "b" },
      operations: [
        { kind: "set-field", field: "description", value: "Bob text" },
      ],
      now: new Date("2026-10-31T11:00:01.000Z"),
      changeId: "bob-1",
    }).document;
    const leftRight = materializeCmsDocument(mergeCmsDocuments(left, right));
    const rightLeft = materializeCmsDocument(mergeCmsDocuments(right, left));

    expect(leftRight).toEqual(rightLeft);
    expect(leftRight.fields).toEqual({
      title: "Alice title",
      description: "Bob text",
    });
    expect(
      mergeCmsDocuments(left, right).changes.map((change) => change.id),
    ).toEqual(["base", "alice-1", "bob-1"]);
  });

  it("rejects malformed locale, unsafe component trees and duplicate creation", async () => {
    expect(() =>
      createCmsDocument({
        identity: { ...identity, locale: "not_a_locale" },
        context: editor,
      }),
    ).toThrow("BCP 47");
    expect(() =>
      createCmsDocument({
        identity,
        context: editor,
        components: [
          {
            id: "child",
            type: "text",
            parentId: "missing",
            position: 1,
            props: {},
          },
        ],
      }),
    ).toThrow("missing parent");

    const drafts = new InMemoryCmsDraftStore();
    const publications = new InMemoryCmsPublicationStore();
    const cms = createCmsService({
      drafts,
      publications,
      publisher: publications,
      featureFlags: flags(),
    });
    await cms.create({ identity, context: editor });
    await expect(cms.create({ identity, context: editor })).rejects.toThrow(
      "already exists",
    );
  });
});

describe("CMS publishing and resolution", () => {
  it("uses locale fallback, caches the raw document, and filters components by user flag", async () => {
    const drafts = new InMemoryCmsDraftStore();
    const publications = new InMemoryCmsPublicationStore();
    const cache = createCache({
      store: new InMemoryCacheStore(),
      defaultTtlMs: 60_000,
    });
    const cms = createCmsService({
      drafts,
      publications,
      publisher: publications,
      featureFlags: flags(),
      cache,
    });
    await cms.create({ identity, context: editor, components: components() });
    await cms.publish({ identity });
    const futureFrench = { ...identity, locale: "fr-TT" };
    await cms.create({
      identity: futureFrench,
      context: editor,
      fields: { title: "À venir" },
    });
    await cms.publish({
      identity: futureFrench,
      releaseId: "future-fr",
      publishAt: new Date("2100-01-01T00:00:00.000Z"),
    });

    const standard = await cms.resolve({
      kind: "page",
      key: "home",
      locales: ["fr-TT", "en-TT"],
      evaluationContext: { targetingKey: "standard-user", attributes: {} },
    });
    const video = await cms.resolve({
      kind: "page",
      key: "home",
      locales: ["en-TT"],
      evaluationContext: {
        targetingKey: "video-user",
        attributes: { interests: ["video"] },
      },
    });
    expect(standard?.components.map((item) => item.id)).toEqual([
      "hero",
      "hero-title",
    ]);
    expect(video?.components.map((item) => item.id)).toEqual([
      "hero",
      "hero-title",
      "video-button",
    ]);
  });

  it("publishes static JSON under the cms prefix", async () => {
    const upload = vi.fn(async (input: { key: string }) => ({
      key: input.key,
      path: `s3://content/${input.key}`,
      url: `https://cdn.example/${input.key}`,
    }));
    const remove = vi.fn(async () => undefined);
    const publisher = createObjectStoreCmsPublisher({
      cdnBaseUrl: () => "https://cdn.example",
      location: (key) => ({
        key,
        path: `s3://content/${key}`,
        url: `https://cdn.example/${key}`,
      }),
      createUploadUrl: vi.fn(),
      confirmUpload: vi.fn(),
      upload,
      head: vi.fn(),
      exists: vi.fn(),
      delete: remove,
      setStorageTier: vi.fn(),
      updateMetadata: vi.fn(),
    });
    const publication = {
      ...materializeCmsDocument(
        createCmsDocument({
          identity,
          context: editor,
          components: components(),
        }),
      ),
      releaseId: "home-v1",
      publishAt: "2026-10-31T00:00:00.000Z",
      publishedAt: "2026-10-31T12:00:00.000Z",
    };
    const { deleted: _deleted, ...publishable } = publication;
    await publisher.put(publishable);
    await publisher.delete({ ...identity, locale: "en-TT" }, "home-v1");

    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "cms/pages/home/en-TT/releases/home-v1.json",
        contentType: "application/json; charset=utf-8",
      }),
    );
    expect(remove).toHaveBeenCalledWith({
      key: "cms/pages/home/en-TT/releases/home-v1.json",
    });
  });

  it("selects scheduled seasonal content and tells clients when to revalidate", async () => {
    let current = new Date("2026-10-30T12:00:00.000Z");
    const drafts = new InMemoryCmsDraftStore();
    const publications = new InMemoryCmsPublicationStore();
    const cms = createCmsService({
      drafts,
      publications,
      publisher: publications,
      featureFlags: flags(),
      now: () => current,
    });
    await cms.create({
      identity,
      context: editor,
      fields: { theme: "standard" },
    });
    await cms.publish({
      identity,
      releaseId: "standard",
      publishAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await cms.edit({
      identity,
      context: editor,
      operations: [{ kind: "set-field", field: "theme", value: "halloween" }],
    });
    await cms.publish({
      identity,
      releaseId: "halloween-2026",
      publishAt: new Date("2026-10-31T00:00:00.000Z"),
      expiresAt: new Date("2026-11-01T00:00:00.000Z"),
    });

    const resolve = () =>
      cms.resolve({
        kind: "page",
        key: "home",
        locales: ["en-TT"],
        evaluationContext: { targetingKey: "user-1", attributes: {} },
      });
    await expect(resolve()).resolves.toMatchObject({
      releaseId: "standard",
      fields: { theme: "standard" },
      cacheUntil: "2026-10-31T00:00:00.000Z",
    });
    current = new Date("2026-10-31T00:00:00.000Z");
    await expect(resolve()).resolves.toMatchObject({
      releaseId: "halloween-2026",
      fields: { theme: "halloween" },
      cacheUntil: "2026-11-01T00:00:00.000Z",
    });
    current = new Date("2026-11-01T00:00:00.000Z");
    await expect(resolve()).resolves.toMatchObject({
      releaseId: "standard",
      fields: { theme: "standard" },
    });
  });

  it("rejects invalid publication windows", async () => {
    const drafts = new InMemoryCmsDraftStore();
    const publications = new InMemoryCmsPublicationStore();
    const cms = createCmsService({
      drafts,
      publications,
      publisher: publications,
      featureFlags: flags(),
    });
    await cms.create({ identity, context: editor });
    await expect(
      cms.publish({
        identity,
        publishAt: new Date("2026-11-01T00:00:00.000Z"),
        expiresAt: new Date("2026-10-31T00:00:00.000Z"),
      }),
    ).rejects.toThrow("later than publishAt");
  });

  it("never allows feature flags in compliance policy content", async () => {
    const drafts = new InMemoryCmsDraftStore();
    const publications = new InMemoryCmsPublicationStore();
    const cms = createCmsService({
      drafts,
      publications,
      publisher: publications,
      featureFlags: flags(),
    });
    const policyIdentity = {
      kind: "page" as const,
      key: "policies/privacy",
      locale: "en-TT",
    };
    await cms.create({
      identity: policyIdentity,
      context: editor,
      components: [{ ...components()[2]!, parentId: null }],
    });
    await expect(cms.publish({ identity: policyIdentity })).rejects.toThrow(
      "cannot use feature flags",
    );
  });

  it("validates the exact active compliance policy release and locale", async () => {
    const drafts = new InMemoryCmsDraftStore();
    const publications = new InMemoryCmsPublicationStore();
    const cms = createCmsService({
      drafts,
      publications,
      publisher: publications,
      featureFlags: flags(),
      now: () => new Date("2026-10-31T12:00:00.000Z"),
    });
    const policyIdentity = {
      kind: "page" as const,
      key: "policies/privacy",
      locale: "en-TT",
    };
    await cms.create({
      identity: policyIdentity,
      context: editor,
      components: [{ ...components()[1]!, parentId: null }],
    });
    await cms.publish({
      identity: policyIdentity,
      releaseId: "privacy-2026-10",
    });

    await expect(
      cms.isPublishedVersion({
        policyKey: "policies/privacy",
        policyVersion: "privacy-2026-10",
        locale: "en-TT",
        at: new Date("2026-10-31T12:00:00.000Z"),
      }),
    ).resolves.toBe(true);
    await expect(
      cms.isPublishedVersion({
        policyKey: "policies/privacy",
        policyVersion: "made-up",
        locale: "en-TT",
        at: new Date("2026-10-31T12:00:00.000Z"),
      }),
    ).resolves.toBe(false);
  });
});
