import { DomainError } from "../errors/index.js";

export const LIFE_LOG_LIMITS = {
  description: 10_000,
  type: 64,
  metadataKey: 128,
  metadataValue: 2_000,
  batch: 200,
} as const;

/** Stable categories shared by manual entry, AI imports, filtering, and persistence. */
export const LIFE_LOG_CATEGORIES = [
  "health",
  "medication",
  "food",
  "exercise",
  "sleep",
  "mood",
  "social",
  "work",
  "travel",
  "finance",
  "household",
  "personal-care",
  "entertainment",
  "dream",
  "visualization",
  "manifestation",
  "prayer",
  "idea",
  "journal",
  "other",
] as const;
export const LIFE_LOG_TYPES = [...LIFE_LOG_CATEGORIES, "metadata"] as const;
export type LifeLogCategory = (typeof LIFE_LOG_CATEGORIES)[number];
export type LifeLogType = (typeof LIFE_LOG_TYPES)[number];
const LIFE_LOG_TYPE_SET: ReadonlySet<string> = new Set(LIFE_LOG_TYPES);

export interface LifeLog {
  id: string;
  userId: string;
  description: string;
  type: LifeLogType;
  occurredAt: Date;
  timeZone: string;
  localDate: string;
  localTime: string;
  metadataKey: string | null;
  metadataValue: string | null;
  createdAt: Date;
}

export interface NewLifeLog extends Omit<LifeLog, "id" | "createdAt"> {}

export interface LifeLogTimestamp {
  occurredAt: Date;
  timeZone: string;
  localDate: string;
  localTime: string;
}

export function parseLifeLogTimestamp(input: {
  timestamp?: string | undefined;
  timeZone: string;
  now?: Date | undefined;
}): LifeLogTimestamp {
  const timeZone = parseTimeZone(input.timeZone);
  if (!input.timestamp?.trim())
    return timestampFromInstant(input.now ?? new Date(), timeZone);

  const value = input.timestamp.trim();
  const local =
    /^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (local) {
    const [, dd, mm, yyyy, hh, minute, second = "00"] = local;
    const parts = {
      year: Number(yyyy),
      month: Number(mm),
      day: Number(dd),
      hour: Number(hh),
      minute: Number(minute),
      second: Number(second),
    };
    assertCalendarParts(parts, value);
    const candidates = localCandidates(parts, timeZone);
    if (candidates.length === 0)
      throw invalidTimestamp(
        `"${value}" does not exist in ${timeZone} (a daylight-saving clock change may skip it).`,
      );
    if (candidates.length > 1)
      throw invalidTimestamp(
        `"${value}" occurs twice in ${timeZone}. Use ISO 8601 with an explicit offset, such as 2026-11-01T01:30:00-04:00.`,
      );
    return timestampFromInstant(candidates[0]!, timeZone);
  }

  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    throw invalidTimestamp(
      `Use DD-MM-YYYY HH:mm[:ss] or ISO 8601 with an offset; received "${value}".`,
    );
  const occurredAt = new Date(value);
  if (Number.isNaN(occurredAt.getTime()))
    throw invalidTimestamp(`"${value}" is not a valid date and time.`);
  return timestampFromInstant(occurredAt, timeZone);
}

export function parseTimeZone(value: string): string {
  const timeZone = value.trim();
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(0));
  } catch {
    throw new DomainError(
      "INVALID_TIME_ZONE",
      `"${value}" is not a valid IANA timezone.`,
      { timeZone: value },
    );
  }
  return timeZone;
}

export function normalizeLifeLogText(
  value: string,
  field: "description" | "type" | "metadataKey" | "metadataValue",
): string {
  const text = value.trim();
  const max = LIFE_LOG_LIMITS[field];
  if (
    !text ||
    text.length > max ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)
  )
    throw new DomainError(
      "INVALID_LIFE_LOG",
      `${field} must contain 1-${max} printable characters.`,
      { field, maxLength: max },
    );
  return text;
}

export function parseLifeLogType(value: string): LifeLogType {
  const type = normalizeLifeLogText(value, "type").toLowerCase();
  if (!LIFE_LOG_TYPE_SET.has(type))
    throw new DomainError(
      "INVALID_LIFE_LOG",
      `type must be one of: ${LIFE_LOG_TYPES.join(", ")}.`,
      { field: "type", allowedTypes: LIFE_LOG_TYPES },
    );
  return type as LifeLogType;
}

function timestampFromInstant(
  occurredAt: Date,
  timeZone: string,
): LifeLogTimestamp {
  if (Number.isNaN(occurredAt.getTime()))
    throw invalidTimestamp("The timestamp is invalid.");
  const parts = formatParts(occurredAt, timeZone);
  return {
    occurredAt,
    timeZone,
    localDate: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    localTime: `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`,
  };
}

function localCandidates(parts: DateParts, timeZone: string): Date[] {
  const target = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = new Date(target + hours * 3_600_000);
    const shown = formatParts(probe, timeZone);
    offsets.add(
      Date.UTC(
        shown.year,
        shown.month - 1,
        shown.day,
        shown.hour,
        shown.minute,
        shown.second,
      ) - probe.getTime(),
    );
  }
  return [...offsets]
    .map((offset) => new Date(target - offset))
    .filter((date) => sameParts(formatParts(date, timeZone), parts))
    .sort((a, b) => a.getTime() - b.getTime());
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function formatParts(date: Date, timeZone: string): DateParts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values["year"]),
    month: Number(values["month"]),
    day: Number(values["day"]),
    hour: Number(values["hour"]),
    minute: Number(values["minute"]),
    second: Number(values["second"]),
  };
}

function assertCalendarParts(parts: DateParts, source: string): void {
  const rebuilt = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );
  if (
    parts.year < 1 ||
    parts.year > 9999 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59 ||
    rebuilt.getUTCFullYear() !== parts.year ||
    rebuilt.getUTCMonth() + 1 !== parts.month ||
    rebuilt.getUTCDate() !== parts.day
  )
    throw invalidTimestamp(`"${source}" is not a real calendar date and time.`);
}

const sameParts = (a: DateParts, b: DateParts) =>
  a.year === b.year &&
  a.month === b.month &&
  a.day === b.day &&
  a.hour === b.hour &&
  a.minute === b.minute &&
  a.second === b.second;
const pad = (value: number) => String(value).padStart(2, "0");
const invalidTimestamp = (message: string) =>
  new DomainError("INVALID_TIMESTAMP", message, {
    acceptedFormats: [
      "DD-MM-YYYY HH:mm",
      "DD-MM-YYYY HH:mm:ss",
      "ISO 8601 with offset",
    ],
  });
