import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageKey, TextDocumentStore } from "./index.js";

/** Local, atomic UTF-8 storage. Keys remain relative and cannot escape the configured root. */
export function createLocalTextDocumentStore(options: {
  root: string;
}): TextDocumentStore {
  const root = path.resolve(options.root);
  if (!path.isAbsolute(options.root))
    throw new TypeError("Local text storage root must be an absolute path.");
  const resolveKey = (key: StorageKey) => {
    if (
      !key ||
      key.startsWith("/") ||
      key.includes("\\") ||
      key
        .split("/")
        .some((part) => part === "" || part === "." || part === "..")
    )
      throw new TypeError(
        "Storage keys must be safe relative slash-separated paths.",
      );
    const target = path.resolve(root, key);
    if (!target.startsWith(`${root}${path.sep}`))
      throw new TypeError("Storage key escapes the configured root.");
    return target;
  };
  return {
    async read(key) {
      try {
        return await readFile(resolveKey(key), "utf8");
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },
    async write(key, content) {
      const target = resolveKey(key);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, target);
    },
    async list(prefix = "sessions") {
      const directory = resolveKey(prefix);
      try {
        return (
          await readdir(directory, { recursive: true, withFileTypes: true })
        )
          .filter((entry) => entry.isFile())
          .map((entry) =>
            path
              .relative(root, path.join(entry.parentPath, entry.name))
              .split(path.sep)
              .join("/"),
          )
          .sort();
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
    },
  };
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
