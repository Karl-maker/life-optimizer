export interface RedisCacheConfiguration {
  /** Connection URL; treat it as a secret because it can contain credentials. */
  url: string;
}

/**
 * Validates Redis adapter configuration at the composition boundary. This
 * package stays client-library-neutral; callers create and connect the client.
 */
export function readRedisCacheConfiguration(
  environment: NodeJS.ProcessEnv,
): RedisCacheConfiguration {
  const url = environment.EDU_CACHE_REDIS_URL?.trim();
  if (!url)
    throw new Error(
      "EDU_CACHE_REDIS_URL is required for the Redis cache adapter.",
    );
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "EDU_CACHE_REDIS_URL must be a valid redis:// or rediss:// URL.",
    );
  }
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:")
    throw new Error(
      "EDU_CACHE_REDIS_URL must use the redis:// or rediss:// protocol.",
    );
  return { url };
}
