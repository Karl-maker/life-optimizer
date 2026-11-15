import { describe, expect, it } from "vitest";
import {
  createCmsService,
  InMemoryCmsDraftStore,
  InMemoryCmsPublicationStore,
} from "@life-optimizer/cms";
import {
  createFeatureFlagEvaluator,
  defineFlag,
  InMemoryExposureRecorder,
} from "@life-optimizer/feature-flags";
import { createApiServer } from "../src/index.js";

const principalId = "00000000-0000-4000-8000-000000000001";
const headers = { authorization: "Bearer test" };

function fixture(
  permissions: readonly string[] = [
    "user",
    "cms:read",
    "cms:write",
    "cms:publish",
    "cms:delete",
  ],
) {
  const drafts = new InMemoryCmsDraftStore();
  const publications = new InMemoryCmsPublicationStore();
  const featureFlags = createFeatureFlagEvaluator({
    recorder: new InMemoryExposureRecorder(),
    flags: [
      defineFlag({
        schemaVersion: 1,
        key: "home.promotion",
        version: "1",
        enabled: true,
        offVariant: "off",
        defaultVariant: "off",
        variants: [
          { key: "off", value: false },
          { key: "on", value: true },
        ],
        rules: [
          {
            id: "beta-audience",
            when: {
              kind: "attribute",
              attribute: "audience",
              operator: "equals",
              value: "beta",
            },
            serve: { kind: "variant", variant: "on" },
          },
        ],
      }),
    ],
  });
  return {
    cms: createCmsService({
      drafts,
      publications,
      publisher: publications,
      featureFlags,
      now: () => new Date("2026-11-10T12:00:00.000Z"),
    }),
    authenticator: {
      authenticate: async () => ({
        id: principalId,
        kind: "bearer" as const,
        permissions,
      }),
    },
  };
}

describe("CMS routes", () => {
  it("creates, edits and publishes through admin routes, then resolves language and flag defaults", async () => {
    const { cms, authenticator } = fixture();
    const app = await createApiServer({
      cms: { service: cms, authenticator, defaultLocales: ["en"] },
    });

    const created = await app.inject({
      method: "POST",
      url: "/admin/cms/documents",
      headers,
      payload: {
        kind: "page",
        key: "home",
        lang: "en",
        fields: { title: "Home" },
        components: [
          {
            id: "heading",
            type: "text",
            parentId: null,
            position: 100,
            props: { text: "Welcome" },
          },
          {
            id: "promotion",
            type: "text",
            parentId: null,
            position: 200,
            props: { text: "Limited offer" },
            gate: {
              kind: "flag",
              flagKey: "home.promotion",
              variants: ["on"],
            },
          },
        ],
      },
    });
    expect(created.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: "POST",
      url: "/admin/cms/documents",
      headers,
      payload: { kind: "page", key: "home", lang: "en" },
    });
    expect(duplicate.statusCode).toBe(409);

    const malformedGate = await app.inject({
      method: "POST",
      url: "/admin/cms/documents",
      headers,
      payload: {
        kind: "page",
        key: "bad-gate",
        lang: "en",
        components: [
          {
            id: "offer",
            type: "text",
            parentId: null,
            position: 100,
            props: {},
            gate: { kind: "all" },
          },
        ],
      },
    });
    expect(malformedGate.statusCode).toBe(400);

    const edited = await app.inject({
      method: "PATCH",
      url: "/admin/cms/documents/page?key=home&lang=en",
      headers,
      payload: {
        operations: [
          { kind: "set-field", field: "description", value: "Landing page" },
        ],
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().fields).toEqual({
      title: "Home",
      description: "Landing page",
    });

    const published = await app.inject({
      method: "POST",
      url: "/admin/cms/documents/page/releases?key=home&lang=en",
      headers,
      payload: { releaseId: "home-v1" },
    });
    expect(published.statusCode).toBe(201);

    const resolved = await app.inject({
      method: "GET",
      url: "/cms/documents/page?key=home&lang=fr-CA",
      headers,
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      identity: { locale: "en" },
      releaseId: "home-v1",
    });
    expect(
      resolved.json().components.map((item: { id: string }) => item.id),
    ).toEqual(["heading"]);
    expect(resolved.headers["cache-control"]).toBe("private, no-store");
    expect(resolved.headers.etag).toMatch(/^"home-v1:/);

    const audienceApp = await createApiServer({
      cms: {
        service: cms,
        authenticator,
        resolveFlagAttributes: async () => ({ audience: "beta" }),
      },
    });
    const audienceResolved = await audienceApp.inject({
      method: "GET",
      url: "/cms/documents/page?key=home&lang=en",
      headers,
    });
    expect(
      audienceResolved.json().components.map((item: { id: string }) => item.id),
    ).toEqual(["heading", "promotion"]);
    await audienceApp.close();

    const unpublished = await app.inject({
      method: "DELETE",
      url: "/admin/cms/documents/page/releases/home-v1?key=home&lang=en",
      headers,
    });
    expect(unpublished.statusCode).toBe(204);
    const afterUnpublish = await app.inject({
      method: "GET",
      url: "/cms/documents/page?key=home",
      headers,
    });
    expect(afterUnpublish.statusCode).toBe(404);

    await app.close();
  });

  it("returns not found for missing published content and protects authoring", async () => {
    const { cms, authenticator } = fixture(["user"]);
    const app = await createApiServer({ cms: { service: cms, authenticator } });

    const missing = await app.inject({
      method: "GET",
      url: "/cms/documents/screen?key=welcome",
      headers,
    });
    expect(missing.statusCode).toBe(404);

    const denied = await app.inject({
      method: "POST",
      url: "/admin/cms/documents",
      headers,
      payload: { kind: "screen", key: "welcome", lang: "en" },
    });
    expect(denied.statusCode).toBe(403);

    const invalidLanguage = await app.inject({
      method: "GET",
      url: "/cms/documents/screen?key=welcome&lang=en--TT",
      headers,
    });
    expect(invalidLanguage.statusCode).toBe(400);

    await app.close();
  });
});
