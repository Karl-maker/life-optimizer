import {
  LIFE_LOG_CATEGORIES,
  LIFE_LOG_TYPES,
  type LifeLogCategory,
  type LifeLogType,
} from "@life-optimizer/core";
import { z } from "zod";

export const lifeLogCategorySchema: z.ZodType<LifeLogCategory> = categorySchema(
  LIFE_LOG_CATEGORIES,
  { metadataReserved: true },
);

export const lifeLogTypeFilterSchema: z.ZodType<LifeLogType> =
  categorySchema(LIFE_LOG_TYPES);

function categorySchema<const T extends readonly [string, ...string[]]>(
  categories: T,
  options: { metadataReserved?: boolean } = {},
) {
  return z
    .string()
    .trim()
    .toLowerCase()
    .superRefine((value, ctx) => {
      if (categories.includes(value)) return;
      if (options.metadataReserved && value === "metadata") {
        ctx.addIssue({
          code: "custom",
          message:
            "uses the dedicated `life-optimizer metadata add` command; metadata is not a normal log category",
        });
        return;
      }
      const suggestion = closestCategory(value, categories);
      ctx.addIssue({
        code: "custom",
        message: suggestion
          ? `is not supported. Did you mean "${suggestion}"? Available categories: ${categories.join(", ")}`
          : `is not supported. Available categories: ${categories.join(", ")}`,
      });
    })
    .transform((value) => value as T[number]);
}

function closestCategory(
  value: string,
  categories: readonly string[],
): string | undefined {
  if (!value) return undefined;
  const ranked = categories
    .map((category) => ({ category, distance: editDistance(value, category) }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.category.localeCompare(right.category),
    );
  const closest = ranked[0];
  if (!closest) return undefined;
  const threshold = Math.max(2, Math.floor(value.length / 3));
  return closest.distance <= threshold ? closest.category : undefined;
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++)
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? right.length;
}
