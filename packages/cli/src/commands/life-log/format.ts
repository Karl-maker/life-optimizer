import type { LifeLog } from "@edu-service/core";
import { renderTable } from "../../output/table.js";

export function renderLifeLogs(logs: readonly LifeLog[]): string {
  if (logs.length === 0) return "No matching life logs.";
  return renderTable(
    ["LOCAL TIME", "ZONE", "TYPE", "DESCRIPTION", "METADATA", "ID"],
    logs.map((log) => [
      `${log.localDate} ${log.localTime}`,
      log.timeZone,
      log.type,
      log.description,
      log.metadataKey ? `${log.metadataKey}=${log.metadataValue}` : "—",
      log.id,
    ]),
  );
}
