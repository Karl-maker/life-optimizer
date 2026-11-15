import type { LifeLog } from "@life-optimizer/core";
import { renderTable } from "../../output/table.js";

export interface LifeLogDisplayOptions {
  showId?: boolean;
  showTimezone?: boolean;
}

export function renderLifeLogs(
  logs: readonly LifeLog[],
  options: LifeLogDisplayOptions = {},
): string {
  if (logs.length === 0) return "No matching life logs.";

  const headers = [
    "TIME",
    "TYPE",
    "DESCRIPTION",
    ...(options.showTimezone ? ["TIMEZONE"] : []),
    ...(options.showId ? ["ID"] : []),
  ];

  return renderTable(
    headers,
    logs.map((log) => [
      `${log.localDate} ${log.localTime}`,
      log.type,
      log.description,
      ...(options.showTimezone ? [log.timeZone] : []),
      ...(options.showId ? [log.id] : []),
    ]),
  );
}
