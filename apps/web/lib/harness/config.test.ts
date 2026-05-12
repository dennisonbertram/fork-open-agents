import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const configModulePromise = import("./config");

function asEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...env } as NodeJS.ProcessEnv;
}

describe("harness config", () => {
  test("is disabled by default", async () => {
    const { getHarnessConfig } = await configModulePromise;

    expect(getHarnessConfig(asEnv({}))).toEqual({
      enabled: false,
      allowedDirectMode: false,
      logJson: false,
      requestTimeoutMs: 15_000,
      sseReplayLimit: 100,
    });
  });

  test("requires base URL, token, and tenant when enabled", async () => {
    const { getHarnessConfig, HarnessConfigError } = await configModulePromise;

    expect(() => getHarnessConfig(asEnv({ HARNESS_ENABLED: "true" }))).toThrow(
      HarnessConfigError,
    );
  });

  test("rejects non-origin base URLs", async () => {
    const { getHarnessConfig } = await configModulePromise;
    const base = {
      HARNESS_ENABLED: "true",
      HARNESS_SERVICE_TOKEN: "token",
      HARNESS_TENANT_ID: "tenant",
    };

    expect(() =>
      getHarnessConfig(
        asEnv({ ...base, HARNESS_BASE_URL: "ftp://example.com" }),
      ),
    ).toThrow();
    expect(() =>
      getHarnessConfig(
        asEnv({
          ...base,
          HARNESS_BASE_URL: "https://user:pass@example.com",
        }),
      ),
    ).toThrow();
    expect(() =>
      getHarnessConfig(
        asEnv({
          ...base,
          HARNESS_BASE_URL: "https://example.com/path?x=1",
        }),
      ),
    ).toThrow();
  });

  test("normalizes an enabled origin config", async () => {
    const { getHarnessConfig } = await configModulePromise;

    expect(
      getHarnessConfig(
        asEnv({
          HARNESS_ENABLED: "true",
          HARNESS_BASE_URL: "https://harness.example.com/",
          HARNESS_SERVICE_TOKEN: "token",
          HARNESS_TENANT_ID: "tenant",
          HARNESS_DEFAULT_PROJECT_ID: "project",
          HARNESS_ALLOWED_DIRECT_MODE: "true",
        }),
      ),
    ).toMatchObject({
      enabled: true,
      baseUrl: "https://harness.example.com",
      serviceToken: "token",
      tenantId: "tenant",
      defaultProjectId: "project",
      allowedDirectMode: true,
    });
  });
});
