import type { FastifyInstance } from "fastify";
import { defineJsonRoute } from "../../contracts.js";

/**
 * Temporary in-memory learning-path catalog until Prisma models land.
 * Owns the canonical `{slug}/{id}` URL shape the client SSR loader expects.
 */
const SAMPLE_PATH = {
  id: "193840441a2b3c4d5e6f708192a3b4c5",
  slug: "waves-and-frequency",
  title: "Waves and frequency",
  topic: "Waves and frequency (introductory physics)",
  level: "Beginner",
  goal: "Understand how to describe and compare waves.",
  summary: "Describe a wave by its height, spacing and how often it repeats.",
  sample: true,
  icon: "waves",
  quests: [
    {
      id: "q1",
      title: "Measure wave height",
      skill: "Identify and measure amplitude",
      concepts: ["Amplitude", "Rest line", "Crest", "Trough"],
      icon: "ruler",
      resources: [{ type: "Video", title: "A ripple tank demonstration" }],
      progress: {
        stage: 4,
        done: [true, true, true, true, true],
        completedAt: null,
        reviewDue: null,
      },
    },
    {
      id: "q2",
      title: "Compare wavelengths",
      skill: "Calculate and compare wavelength",
      concepts: ["Wavelength", "Crest to crest", "Metres"],
      icon: "waves",
      resources: [{ type: "Tool", title: "A wave-on-a-string simulator" }],
      progress: {
        stage: 1,
        done: [true, false, false, false, false],
        completedAt: null,
        reviewDue: null,
      },
    },
    {
      id: "q3",
      title: "Read frequency",
      skill: "Calculate and compare frequency",
      concepts: ["Frequency", "Cycle", "Hertz"],
      icon: "activity",
      resources: [{ type: "Practice", title: "Frequency counting drills" }],
      progress: {
        stage: 0,
        done: [false, false, false, false, false],
        completedAt: null,
        reviewDue: null,
      },
    },
    {
      id: "q4",
      title: "Link speed and frequency",
      skill: "Use wave speed = frequency × wavelength",
      concepts: ["Wave speed", "v = f × λ", "Units"],
      icon: "gauge",
      resources: [{ type: "Practice", title: "Wave equation worksheet" }],
      progress: {
        stage: 0,
        done: [false, false, false, false, false],
        completedAt: null,
        reviewDue: null,
      },
    },
    {
      id: "q5",
      title: "Find the period",
      skill: "Calculate period from frequency",
      concepts: ["Period", "T = 1 ÷ f", "Seconds"],
      icon: "timer",
      resources: [{ type: "Reading", title: "Textbook section on period" }],
      progress: {
        stage: 0,
        done: [false, false, false, false, false],
        completedAt: null,
        reviewDue: null,
      },
    },
  ],
} as const;

const CATALOG = [SAMPLE_PATH];

const pathId = {
  type: "string",
  minLength: 8,
  maxLength: 64,
  pattern: "^[a-zA-Z0-9_-]+$",
  description: "Opaque learning-path identifier.",
  examples: ["193840441a2b3c4d5e6f708192a3b4c5"],
} as const;

const pathSlug = {
  type: "string",
  minLength: 1,
  maxLength: 80,
  pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  description: "URL slug derived from the path title.",
  examples: ["waves-and-frequency"],
} as const;

const pathSchema = {
  type: "object",
  additionalProperties: true,
  required: ["id", "slug", "title", "quests"],
  properties: {
    id: pathId,
    slug: pathSlug,
    title: { type: "string" },
    topic: { type: "string" },
    level: { type: "string" },
    goal: { type: "string" },
    summary: { type: "string" },
    sample: { type: "boolean" },
    icon: { type: "string" },
    quests: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
} as const;

export function registerLearningPathRoutes(app: FastifyInstance): void {
  app.get(
    "/learning-paths",
    {
      schema: defineJsonRoute({
        summary: "List learning paths",
        description:
          "Returns learning paths visible to the caller. Sample catalog until owned-path persistence lands.",
        tags: ["Learning paths"],
        operationId: "listLearningPaths",
        response: {
          200: {
            description: "Learning path summaries.",
            type: "object",
            additionalProperties: false,
            required: ["paths"],
            properties: {
              paths: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "slug", "title"],
                  properties: {
                    id: pathId,
                    slug: pathSlug,
                    title: { type: "string" },
                    topic: { type: "string" },
                    level: { type: "string" },
                    sample: { type: "boolean" },
                  },
                },
              },
            },
          },
        },
      }),
    },
    async (_request, reply) => {
      reply.header("cache-control", "private, no-store");
      return {
        paths: CATALOG.map((path) => ({
          id: path.id,
          slug: path.slug,
          title: path.title,
          topic: path.topic,
          level: path.level,
          sample: path.sample,
        })),
      };
    },
  );

  app.get(
    "/learning-paths/:slug/:id",
    {
      schema: defineJsonRoute({
        summary: "Get a learning path by slug and id",
        description:
          "Canonical lookup for client routes shaped like /path/{slug}/{id}. Slug must match the stored title slug.",
        tags: ["Learning paths"],
        operationId: "getLearningPathBySlugId",
        problemResponses: [404],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "id"],
          properties: { slug: pathSlug, id: pathId },
        },
        response: {
          200: {
            description: "Learning path detail.",
            type: "object",
            additionalProperties: false,
            required: ["path"],
            properties: { path: pathSchema },
          },
        },
      }),
    },
    async (request, reply) => {
      const { slug, id } = request.params as { slug: string; id: string };
      const path = CATALOG.find((item) => item.id === id && item.slug === slug);
      if (!path) {
        return reply.code(404).type("application/problem+json").send({
          type: "/problems/not-found",
          title: "Learning path not found",
          status: 404,
          code: "LEARNING_PATH_NOT_FOUND",
          requestId: request.id,
        });
      }
      reply.header("cache-control", "private, no-store");
      return { path };
    },
  );
}
