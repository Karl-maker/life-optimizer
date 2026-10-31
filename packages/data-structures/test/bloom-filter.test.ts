import { describe, expect, it } from "vitest";
import { BloomFilter } from "../src/index.js";

describe("BloomFilter", () => {
  it("never reports an inserted key as definitely absent", () => {
    const filter = new BloomFilter<string>({
      expectedInsertions: 100,
      serialize: (value) => value,
    });
    filter.addMany(["lesson:1", "lesson:2", "lesson:3"]);
    expect(filter.mightContain("lesson:1")).toBe(true);
    expect(filter.getStats()).toMatchObject({
      insertions: 3,
      memoryBytes: expect.any(Number),
    });
  });

  it("clears state and validates sizing options", () => {
    const filter = new BloomFilter<string>({
      expectedInsertions: 1,
      falsePositiveRate: 0.01,
      serialize: (value) => value,
    });
    filter.add("one");
    filter.clear();
    expect(filter.getStats().insertions).toBe(0);
    expect(
      () =>
        new BloomFilter<string>({
          expectedInsertions: 0,
          serialize: (value) => value,
        }),
    ).toThrow("expectedInsertions");
    expect(
      () =>
        new BloomFilter<string>({
          expectedInsertions: 1,
          falsePositiveRate: 1,
          serialize: (value) => value,
        }),
    ).toThrow("falsePositiveRate");
  });
});
