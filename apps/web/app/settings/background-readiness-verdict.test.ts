import { describe, expect, test } from "bun:test";
import { mapReadinessToVerdict } from "./background-readiness-verdict";

const SCREAMING_SNAKE_RE = /[A-Z]{2,}_[A-Z_]+/;

describe("mapReadinessToVerdict", () => {
  test("BT-001: ready=true produces status 'ready' with a plain-language headline", () => {
    const result = mapReadinessToVerdict({
      enabled: true,
      ready: true,
      missing: [],
      checks: [
        {
          id: "feature_flag",
          label: "Feature flag",
          status: "ready",
          detail: "BACKGROUND_AGENTS_ENABLED gates trigger dispatch.",
          missing: [],
        },
      ],
    });

    expect(result.status).toBe("ready");
    expect(result.headline).toContain("Background agents are enabled");
    expect(SCREAMING_SNAKE_RE.test(result.headline)).toBe(false);
  });

  test("BT-002: enabled=true, ready=false produces status 'action-needed' with a plain-language headline", () => {
    const result = mapReadinessToVerdict({
      enabled: true,
      ready: false,
      missing: ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"],
      checks: [
        {
          id: "github_app",
          label: "GitHub App",
          status: "missing",
          detail: "Required for webhook trust.",
          missing: ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"],
        },
      ],
    });

    expect(result.status).toBe("action-needed");
    expect(result.headline).toContain("need");
    // Headline must NOT contain raw env-var tokens
    expect(SCREAMING_SNAKE_RE.test(result.headline)).toBe(false);
  });

  test("BT-003: enabled=false produces status 'unavailable' with an admin-guidance headline", () => {
    const result = mapReadinessToVerdict({
      enabled: false,
      ready: false,
      missing: ["BACKGROUND_AGENTS_ENABLED"],
      checks: [
        {
          id: "feature_flag",
          label: "Feature flag",
          status: "disabled",
          detail: "BACKGROUND_AGENTS_ENABLED gates trigger dispatch.",
          missing: ["BACKGROUND_AGENTS_ENABLED"],
        },
      ],
    });

    expect(result.status).toBe("unavailable");
    expect(result.headline).toContain("Background agents");
    // Headline must NOT contain raw env-var tokens
    expect(SCREAMING_SNAKE_RE.test(result.headline)).toBe(false);
    // Subtext should guide the user toward the admin
    expect(result.subtext).toBeDefined();
  });

  test("BT-004: env-var names appear in checks[].missing, never in headline", () => {
    const result = mapReadinessToVerdict({
      enabled: true,
      ready: false,
      missing: ["GITHUB_APP_ID"],
      checks: [
        {
          id: "github_app",
          label: "GitHub App",
          status: "missing",
          detail: "Required for webhook trust.",
          missing: ["GITHUB_APP_ID"],
        },
      ],
    });

    // Headline must be env-var free
    expect(SCREAMING_SNAKE_RE.test(result.headline)).toBe(false);

    // The env-var must appear inside checks[].missing
    const allMissing = result.checks?.flatMap((c) => c.missing ?? []) ?? [];
    expect(allMissing).toContain("GITHUB_APP_ID");
  });

  test("BT-005: checks are mapped from the response with id, label, status preserved", () => {
    const result = mapReadinessToVerdict({
      enabled: true,
      ready: false,
      missing: ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"],
      checks: [
        {
          id: "github_app",
          label: "GitHub App",
          status: "missing",
          detail: "Required for webhook trust.",
          missing: ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"],
        },
        {
          id: "feature_flag",
          label: "Feature flag",
          status: "ready",
          detail: "Feature is enabled.",
          missing: [],
        },
      ],
    });

    expect(result.checks).toHaveLength(2);
    expect(result.checks?.[0]).toMatchObject({
      id: "github_app",
      label: "GitHub App",
      status: "missing",
    });
    expect(result.checks?.[1]).toMatchObject({
      id: "feature_flag",
      label: "Feature flag",
      status: "ready",
    });
  });
});
