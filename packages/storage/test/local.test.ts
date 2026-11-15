import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalTextDocumentStore } from "../src/local.js";

describe("local text document storage", () => {
  it("writes atomically, reads, lists, and blocks traversal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "life-agent-store-"));
    const store = createLocalTextDocumentStore({ root });

    await store.write("sessions/one.json", '{"id":"one"}');

    await expect(store.read("sessions/one.json")).resolves.toBe('{"id":"one"}');
    await expect(store.list("sessions")).resolves.toEqual([
      "sessions/one.json",
    ]);
    await expect(
      readFile(path.join(root, "sessions/one.json"), "utf8"),
    ).resolves.toContain("one");
    await expect(store.read("../secret")).rejects.toThrow(/relative/);
  });
});
