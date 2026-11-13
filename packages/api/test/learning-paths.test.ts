import { describe, expect, it } from "vitest";
import { createApiServer } from "../src/index.js";

describe("learning paths", () => {
  it("lists sample paths and resolves slug/id", async () => {
    const app = await createApiServer();
    const list = await app.inject({ method: "GET", url: "/learning-paths" });
    expect(list.statusCode).toBe(200);
    const listed = list.json() as {
      paths: Array<{ id: string; slug: string; title: string }>;
    };
    expect(listed.paths[0]?.slug).toBe("waves-and-frequency");

    const id = listed.paths[0]!.id;
    const slug = listed.paths[0]!.slug;
    const detail = await app.inject({
      method: "GET",
      url: `/learning-paths/${slug}/${id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().path.title).toBe("Waves and frequency");

    const missing = await app.inject({
      method: "GET",
      url: "/learning-paths/waves-and-frequency/does-not-exist",
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
