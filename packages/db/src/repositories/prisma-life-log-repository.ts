import { parseLifeLogType } from "@life-optimizer/core";
import type {
  LifeLog,
  LifeLogQuery,
  LifeLogRepository,
  NewLifeLog,
} from "@life-optimizer/core";
import type { PrismaClient } from "../generated/client.js";

type LifeLogPrisma = Pick<PrismaClient, "lifeLog">;

export class PrismaLifeLogRepository implements LifeLogRepository {
  constructor(private readonly prisma: LifeLogPrisma) {}

  async createMany(logs: readonly NewLifeLog[]): Promise<readonly LifeLog[]> {
    return (
      await this.prisma.lifeLog.createManyAndReturn({
        data: logs.map((log) => ({
          ...log,
          localDate: new Date(`${log.localDate}T00:00:00.000Z`),
          localTime: new Date(`1970-01-01T${log.localTime}.000Z`),
        })),
      })
    )
      .map(toDomain)
      .sort(
        (a, b) =>
          a.occurredAt.getTime() - b.occurredAt.getTime() ||
          a.id.localeCompare(b.id),
      );
  }

  async list(query: LifeLogQuery): Promise<readonly LifeLog[]> {
    const search = query.search;
    const rows = await this.prisma.lifeLog.findMany({
      where: {
        userId: query.userId,
        ...(query.from || query.to
          ? {
              occurredAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
        ...(query.localDate
          ? { localDate: new Date(`${query.localDate}T00:00:00.000Z`) }
          : {}),
        ...(query.type ? { type: query.type.toLowerCase() } : {}),
        ...(search
          ? {
              OR: [
                { description: { contains: search, mode: "insensitive" } },
                { metadataKey: { contains: search, mode: "insensitive" } },
                { metadataValue: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: query.order }, { id: query.order }],
      ...(query.regex ? {} : { take: query.limit }),
    });
    const logs = rows.map(toDomain);
    if (!query.regex) return logs;
    const regex = new RegExp(query.regex, "iu");
    return logs
      .filter((log) =>
        [log.description, log.metadataKey ?? "", log.metadataValue ?? ""].some(
          (value) => regex.test(value),
        ),
      )
      .slice(0, query.limit);
  }

  async findById(id: string): Promise<LifeLog | null> {
    const value = await this.prisma.lifeLog.findUnique({ where: { id } });
    return value ? toDomain(value) : null;
  }

  async update(log: LifeLog): Promise<LifeLog> {
    return toDomain(
      await this.prisma.lifeLog.update({
        where: { id: log.id },
        data: {
          description: log.description,
          type: log.type,
          occurredAt: log.occurredAt,
          timeZone: log.timeZone,
          localDate: new Date(`${log.localDate}T00:00:00.000Z`),
          localTime: new Date(`1970-01-01T${log.localTime}.000Z`),
        },
      }),
    );
  }
}

function toDomain(value: {
  id: string;
  userId: string;
  description: string;
  type: string;
  occurredAt: Date;
  timeZone: string;
  localDate: Date;
  localTime: Date;
  metadataKey: string | null;
  metadataValue: string | null;
  agentSessionId: string | null;
  createdAt: Date;
}): LifeLog {
  return {
    ...value,
    type: parseLifeLogType(value.type),
    localDate: value.localDate.toISOString().slice(0, 10),
    localTime: value.localTime.toISOString().slice(11, 19),
  };
}
