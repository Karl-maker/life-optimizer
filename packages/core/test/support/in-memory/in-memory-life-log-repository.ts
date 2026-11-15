import { randomUUID } from "node:crypto";
import type {
  LifeLog,
  LifeLogQuery,
  LifeLogRepository,
  NewLifeLog,
} from "../../../src/index.js";

export class InMemoryLifeLogRepository implements LifeLogRepository {
  readonly values: LifeLog[] = [];
  async createMany(logs: readonly NewLifeLog[]): Promise<readonly LifeLog[]> {
    const created = logs.map((log) => ({
      ...log,
      id: randomUUID(),
      createdAt: new Date(),
    }));
    this.values.push(...created);
    return created;
  }
  async list(query: LifeLogQuery): Promise<readonly LifeLog[]> {
    const found = this.values.filter(
      (log) =>
        log.userId === query.userId &&
        (!query.from || log.occurredAt >= query.from) &&
        (!query.to || log.occurredAt <= query.to) &&
        (!query.localDate || log.localDate === query.localDate) &&
        (!query.type || log.type === query.type) &&
        (!query.search ||
          [
            log.description,
            log.metadataKey ?? "",
            log.metadataValue ?? "",
          ].some((value) =>
            value.toLowerCase().includes(query.search!.toLowerCase()),
          )) &&
        (!query.regex ||
          [
            log.description,
            log.metadataKey ?? "",
            log.metadataValue ?? "",
          ].some((value) => new RegExp(query.regex!, "iu").test(value))),
    );
    return found
      .sort(
        (a, b) =>
          (a.occurredAt.getTime() - b.occurredAt.getTime()) *
          (query.order === "asc" ? 1 : -1),
      )
      .slice(0, query.limit);
  }
  async findById(id: string): Promise<LifeLog | null> {
    return this.values.find((log) => log.id === id) ?? null;
  }
  async update(log: LifeLog): Promise<LifeLog> {
    const index = this.values.findIndex((value) => value.id === log.id);
    if (index < 0) throw new Error(`Life log ${log.id} was not found.`);
    this.values[index] = log;
    return log;
  }
}
