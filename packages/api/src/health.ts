import os from "node:os";

export interface HealthCheck {
  name: string;
  check(): Promise<void>;
}

export interface HealthSnapshot {
  status: "ok" | "degraded";
  timestamp: string;
  uptimeSeconds: number;
  process: { pid: number; memoryRssBytes: number; heapUsedBytes: number };
  host: {
    cpuCount: number;
    loadAverage: readonly number[];
    totalMemoryBytes: number;
    freeMemoryBytes: number;
  };
  dependencies: readonly { name: string; status: "ok" | "failed" }[];
}

export async function readHealth(
  checks: readonly HealthCheck[] = [],
): Promise<HealthSnapshot> {
  const dependencies = await Promise.all(
    checks.map(async ({ name, check }) => {
      try {
        await check();
        return { name, status: "ok" as const };
      } catch {
        return { name, status: "failed" as const };
      }
    }),
  );
  const memory = process.memoryUsage();
  return {
    status: dependencies.some((check) => check.status === "failed")
      ? "degraded"
      : "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    process: {
      pid: process.pid,
      memoryRssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    },
    host: {
      cpuCount: os.cpus().length,
      loadAverage: os.loadavg(),
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
    },
    dependencies,
  };
}
