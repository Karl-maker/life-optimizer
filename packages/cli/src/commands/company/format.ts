import type { Company } from "@life-optimizer/core";

export const describeCompany = (c: Company): string =>
  [
    `${c.name}`,
    `  country:        ${c.country}`,
    `  registration:  ${c.registryCode ?? "not provided"}`,
    `  status:         ${c.archivedAt ? `archived ${c.archivedAt.toISOString().slice(0, 10)}` : "active"}`,
    `  id:             ${c.id}`,
  ].join("\n");
