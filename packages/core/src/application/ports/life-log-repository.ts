import type { LifeLog, NewLifeLog } from "../../domain/life-log/index.js";

export interface LifeLogQuery {
  userId: string;
  from?: Date | undefined;
  to?: Date | undefined;
  localDate?: string | undefined;
  type?: string | undefined;
  search?: string | undefined;
  regex?: string | undefined;
  limit: number;
  order: "asc" | "desc";
}

export interface LifeLogRepository {
  createMany(logs: readonly NewLifeLog[]): Promise<readonly LifeLog[]>;
  list(query: LifeLogQuery): Promise<readonly LifeLog[]>;
  findById(id: string): Promise<LifeLog | null>;
  update(log: LifeLog): Promise<LifeLog>;
}
