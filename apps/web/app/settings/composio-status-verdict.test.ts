import { describe, expect, test } from "bun:test";
import { mapComposioStatusToVerdict } from "./composio-status-verdict";

const NO_ENV_IN_USER_COPY = /[A-Z]{2,}_[A-Z_]+/;

describe("mapComposioStatusToVerdict", () => {
  test("configured + available → ready, env name only in checks", () => {
    const v = mapComposioStatusToVerdict({
      configured: true,
      available: true,
      reason: "ok",
      message: "ok",
    });
    expect(v.status).toBe("ready");
    expect(v.headline).toContain("connected");
    expect(v.headline).not.toMatch(NO_ENV_IN_USER_COPY);
    expect(v.subtext ?? "").not.toMatch(NO_ENV_IN_USER_COPY);
    expect(v.checks[0]?.present).toContain("COMPOSIO_API_KEY");
  });

  test("not configured → unavailable with admin guidance, no env name in user copy", () => {
    const v = mapComposioStatusToVerdict({
      configured: false,
      available: false,
      reason: "missing_api_key",
      message: "COMPOSIO_API_KEY is not configured.",
    });
    expect(v.status).toBe("unavailable");
    expect(v.headline).not.toMatch(NO_ENV_IN_USER_COPY);
    expect(v.subtext).toContain("administrator");
    expect(v.checks[0]?.missing).toContain("COMPOSIO_API_KEY");
  });

  test("invalid api key → error, env name confined to checks", () => {
    const v = mapComposioStatusToVerdict({
      configured: true,
      available: false,
      reason: "invalid_api_key",
      message: "invalid",
    });
    expect(v.status).toBe("error");
    expect(v.headline).not.toMatch(NO_ENV_IN_USER_COPY);
    expect(v.checks[0]?.present).toContain("COMPOSIO_API_KEY");
  });

  test("undefined status → loading verdict", () => {
    const v = mapComposioStatusToVerdict(undefined);
    expect(v.headline).toContain("Checking");
    expect(v.checks).toHaveLength(0);
  });
});
