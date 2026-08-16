import { afterEach, describe, expect, test } from "bun:test";
import {
  createRedisClient,
  getRedisConnectionOptions,
  getRedisUrl,
  isRedisConfigured,
} from "./redis";

const originalRedisUrl = process.env.REDIS_URL;
const originalKvUrl = process.env.KV_URL;
const originalNodeEnv = process.env.NODE_ENV;
const nodeEnvKey = "NODE_ENV" as keyof NodeJS.ProcessEnv;

afterEach(() => {
  if (originalRedisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = originalRedisUrl;
  }

  if (originalKvUrl === undefined) {
    delete process.env.KV_URL;
  } else {
    process.env.KV_URL = originalKvUrl;
  }

  process.env[nodeEnvKey] = originalNodeEnv;
});

describe("getRedisConnectionOptions", () => {
  test("parses bare host and port values without requiring a scheme", () => {
    expect(getRedisConnectionOptions("localhost:6379")).toEqual({
      host: "localhost",
      port: 6379,
    });
  });

  test("parses secure redis URLs with auth, db, and query parameters", () => {
    expect(
      getRedisConnectionOptions(
        "rediss://user%20name:pa%40ss@[::1]:6380/2?family=6&connectionName=skills-cache",
      ),
    ).toEqual({
      username: "user name",
      password: "pa@ss",
      host: "::1",
      port: 6380,
      db: 2,
      family: 6,
      connectionName: "skills-cache",
      tls: {},
    });
  });

  test("preserves explicit tls query parameters for secure redis URLs", () => {
    expect(
      getRedisConnectionOptions(
        "rediss://localhost:6379?tls=RedisCloudFixed&connectionName=skills-cache",
      ),
    ).toEqual({
      host: "localhost",
      port: 6379,
      tls: "RedisCloudFixed",
      connectionName: "skills-cache",
    });
  });

  test("parses unix socket paths and query defaults", () => {
    expect(
      getRedisConnectionOptions(
        "/tmp/redis.sock?db=1&connectionName=skills-cache",
      ),
    ).toEqual({
      path: "/tmp/redis.sock",
      db: 1,
      connectionName: "skills-cache",
    });
  });

  test("does not let query params override explicit host or db values", () => {
    expect(
      getRedisConnectionOptions(
        "redis://localhost:6379/3?db=1&host=example.com&connectionName=skills-cache",
      ),
    ).toEqual({
      host: "localhost",
      port: 6379,
      db: 3,
      connectionName: "skills-cache",
    });
  });
});

describe("redis configuration", () => {
  test("treats blank environment values as not configured", () => {
    process.env.REDIS_URL = "";
    process.env.KV_URL = "   ";

    expect(getRedisUrl()).toBeNull();
    expect(isRedisConfigured()).toBe(false);
  });

  test("falls back to KV_URL when REDIS_URL is blank", () => {
    process.env[nodeEnvKey] = "production";
    process.env.REDIS_URL = " ";
    process.env.KV_URL = "redis://localhost:6379";

    expect(getRedisUrl()).toBe("redis://localhost:6379");
    expect(isRedisConfigured()).toBe(true);
  });

  test("refuses a live REDIS_URL when running under test", () => {
    process.env[nodeEnvKey] = "test";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    delete process.env.KV_URL;

    // No client is created: the suite must stay hermetic even when the
    // developer's environment points at a real Redis (#1132).
    expect(getRedisUrl()).toBeNull();
    expect(isRedisConfigured()).toBe(false);
    expect(() => createRedisClient()).toThrow(
      "REDIS_URL or KV_URL environment variable is required",
    );
  });

  test("creates a client from REDIS_URL outside test", () => {
    process.env[nodeEnvKey] = "production";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    delete process.env.KV_URL;

    expect(getRedisUrl()).toBe("redis://127.0.0.1:6379");
    expect(isRedisConfigured()).toBe(true);
    const client = createRedisClient();
    client.disconnect();
  });
});
