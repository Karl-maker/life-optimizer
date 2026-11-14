import { parseLifeLogTimestamp } from "@edu-service/core";
import { CliError } from "../../errors/cli-error.js";

export const defaultTimeZone = (env: Record<string, string | undefined>) =>
  env["LIFE_OPTIMIZER_TIME_ZONE"] ??
  Intl.DateTimeFormat().resolvedOptions().timeZone;

export function parseBoundary(
  value: string | undefined,
  timeZone: string,
  end: boolean,
): Date | undefined {
  if (!value) return undefined;
  const date = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  const timestamp = date
    ? `${value.trim()} ${end ? "23:59:59" : "00:00:00"}`
    : value;
  return parseLifeLogTimestamp({ timestamp, timeZone }).occurredAt;
}

export function parseLocalDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  if (!match)
    throw new CliError({
      code: "USAGE",
      message: `--date must use DD-MM-YYYY; received "${value}".`,
    });
  const [, day, month, year] = match;
  parseLifeLogTimestamp({ timestamp: `${value} 12:00:00`, timeZone: "UTC" });
  return `${year}-${month}-${day}`;
}
