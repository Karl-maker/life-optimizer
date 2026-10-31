import { describe, expect, it } from "vitest";
import { Trie, jsonValueCodec, undefinedValueCodec } from "../src/index.js";

describe("Trie", () => {
  it("stores exact entries and distinguishes missing values from undefined", () => {
    const trie = new Trie<undefined>({ language: "en" });
    trie.insert("lesson", undefined);

    expect(trie.search("LESSON")).toEqual({
      found: true,
      key: "lesson",
      value: undefined,
    });
    expect(trie.search("missing")).toEqual({ found: false });
    expect(trie.startsWith("les")).toBe(true);
    expect(trie.startsWith("lex")).toBe(false);
  });

  it("returns normalized-prefix matches in deterministic order and honors limits", () => {
    const trie = new Trie<number>({ language: "en" });
    trie.addMany([
      { key: "apply", value: 1 },
      { key: "apple", value: 2 },
      { key: "ape", value: 3 },
    ]);

    expect(trie.find("AP", 2).map((entry) => entry.key)).toEqual([
      "ape",
      "apple",
    ]);
    expect(trie.find("ap", 0)).toEqual([]);
    expect(() => trie.find("ap", -1)).toThrow("limit");
  });

  it("overwrites duplicate normalized keys, deletes entries, and prunes empty paths", () => {
    const trie = new Trie<number>({ language: "en" });
    trie.insert("Cat", 1).insert("cat", 2).insert("car", 3);
    expect(trie.getStats().entryCount).toBe(2);
    expect(trie.search("CAT")).toEqual({ found: true, key: "cat", value: 2 });
    expect(trie.delete("CAT")).toBe(true);
    expect(trie.delete("cat")).toBe(false);
    expect(trie.find("ca")).toEqual([{ key: "car", value: 3 }]);
    trie.clear();
    expect(trie.getStats()).toMatchObject({ entryCount: 0, nodeCount: 1 });
  });

  it("handles Unicode code points, locale case folding, and opt-in diacritic folding", () => {
    const french = new Trie<number>({
      language: "fr",
      normalizeDiacritics: true,
    });
    french.insert("École", 1);
    expect(french.search("ecole")).toEqual({
      found: true,
      key: "École",
      value: 1,
    });

    const sensitive = new Trie<number>({ language: "tr", caseSensitive: true });
    sensitive.insert("İstanbul", 2);
    expect(sensitive.search("istanbul")).toEqual({ found: false });

    const emoji = new Trie<number>({ language: "en" });
    emoji.insert("👩🏽‍💻 code", 3);
    expect(emoji.startsWith("👩🏽‍💻")).toBe(true);
  });

  it("round-trips a checksummed snapshot into an immutable trie", () => {
    const trie = new Trie<{ id: string }>({
      language: "es",
      normalizeDiacritics: true,
    });
    trie.addMany([
      { key: "niño", value: { id: "a" } },
      { key: "árbol", value: { id: "b" } },
    ]);
    const snapshot = trie.serialize(jsonValueCodec<{ id: string }>());
    const metadata = Trie.inspectSnapshot(snapshot);
    const restored = Trie.deserialize(
      snapshot,
      jsonValueCodec<{ id: string }>(),
    );

    expect(metadata).toMatchObject({
      language: "es",
      entryCount: 2,
      formatVersion: 1,
    });
    expect(restored.search("nino")).toEqual({
      found: true,
      key: "niño",
      value: { id: "a" },
    });
    expect(restored.getStats().readOnly).toBe(true);
    expect(() => restored.insert("otro", { id: "c" })).toThrow("read-only");
  });

  it("rejects corrupted and incompatible snapshots", () => {
    const snapshot = new Trie<undefined>({ language: "en" })
      .insert("word", undefined)
      .serialize(undefinedValueCodec);
    const corrupted = snapshot.slice();
    const finalByte = corrupted.length - 1;
    corrupted[finalByte] = corrupted[finalByte]! ^ 1;
    expect(() => Trie.deserialize(corrupted, undefinedValueCodec)).toThrow(
      "checksum",
    );
    const incompatible = snapshot.slice();
    incompatible[4] = 2;
    expect(() => Trie.deserialize(incompatible, undefinedValueCodec)).toThrow(
      "Unsupported",
    );
  });

  it("handles a realistic bulk dictionary consistently", () => {
    const trie = new Trie<number>({ language: "en" });
    trie.addMany(
      Array.from({ length: 10_000 }, (_, index) => ({
        key: `term-${String(index).padStart(5, "0")}`,
        value: index,
      })),
    );
    expect(trie.getStats().entryCount).toBe(10_000);
    expect(trie.find("term-099", 3).map((entry) => entry.value)).toEqual([
      9900, 9901, 9902,
    ]);
  });
});
