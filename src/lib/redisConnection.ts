import Redis, { RedisOptions } from "ioredis";
import logger from "../utils/logger/logger";

const isProduction = process.env.NODE_ENV === "production";
const maxRetries = isProduction ? 10 : 3;

const redisOptions: RedisOptions = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times: number) => {
    if (!isProduction) {
      // In dev, don't retry at all — fail fast and use in-memory fallback silently
      return null;
    }
    if (times > maxRetries) {
      logger.error(`Redis: max reconnection attempts (${maxRetries}) reached`);
      return null;
    }
    return Math.min(times * 200, 1000);
  },
  connectTimeout: isProduction ? 10000 : 2000,
  lazyConnect: true,
  maxRetriesPerRequest: isProduction ? 3 : 1,
};

export const redis = new Redis(redisOptions);

let isRedisConnected = false;

redis.on("connect", () => {
  isRedisConnected = true;
  logger.info("✅ Redis connected");
});

redis.on("ready", () => {
  isRedisConnected = true;
  logger.info("✅ Redis ready");
});

redis.on("error", (err: Error) => {
  logger.error(`❌ Redis error: ${err.message}`);
});

redis.on("close", () => {
  isRedisConnected = false;
  logger.warn("⚠️  Redis connection closed");
});

redis.on("reconnecting", () => {
  logger.warn("♻️  Redis reconnecting...");
});

redis.on("end", () => {
  isRedisConnected = false;
  logger.warn("⚠️  Redis connection ended. Token blacklist will fallback to in-memory.");
});

// ---------------------------------------------------------------------------
// Token blacklist helpers (used for logout / access token invalidation)
// ---------------------------------------------------------------------------

const BLACKLIST_PREFIX = "blacklist:";

// Fallback in-memory store for blacklist if Redis is not available
const fallbackBlacklist = new Map<string, number>(); // token -> expiry timestamp (ms)

const cleanExpiredTokens = () => {
  const now = Date.now();
  for (const [token, expiry] of fallbackBlacklist.entries()) {
    if (now > expiry) {
      fallbackBlacklist.delete(token);
    }
  }
};

export const blacklistToken = async (token: string, ttlSeconds: number): Promise<void> => {
  if (isRedisConnected) {
    try {
      await redis.set(`${BLACKLIST_PREFIX}${token}`, "1", "EX", ttlSeconds);
      return;
    } catch (err) {
      logger.error("Failed to blacklist token in Redis, falling back to in-memory:", err);
    }
  }
  const expiry = Date.now() + ttlSeconds * 1000;
  fallbackBlacklist.set(token, expiry);
  cleanExpiredTokens();
};

export const isTokenBlacklisted = async (token: string): Promise<boolean> => {
  if (isRedisConnected) {
    try {
      const result = await redis.get(`${BLACKLIST_PREFIX}${token}`);
      return result !== null;
    } catch (err) {
      logger.error("Failed to check token blacklisted in Redis, checking in-memory fallback:", err);
    }
  }
  const expiry = fallbackBlacklist.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    fallbackBlacklist.delete(token);
    return false;
  }
  return true;
};

export default redis;
