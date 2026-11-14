import { parseLifeLogType } from "@edu-service/core";
import type {
  LifeLog,
  LifeLogQuery,
  LifeLogRepository,
  NewLifeLog,
} from "@edu-service/core";
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
    return (
      await this.prisma.lifeLog.findMany({
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
        take: query.limit,
      })
    ).map(toDomain);
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
  createdAt: Date;
}): LifeLog {
  return {
    ...value,
    type: parseLifeLogType(value.type),
    localDate: value.localDate.toISOString().slice(0, 10),
    localTime: value.localTime.toISOString().slice(11, 19),
  };
}
