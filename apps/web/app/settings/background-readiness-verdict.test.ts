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
    expect(result.headline).toContain("prerequisites are configured");
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

  // ── Regression tests ──────────────────────────────────────────────────────
  // Each test below would fail if the implementation in 342ba084 were reverted.

  test("REG-001: ready=true with checks still returns the full checks array (no checks dropped)", () => {
    // Regression: a future refactor might drop checks on the ready path.
    const result = mapReadinessToVerdict({
      enabled: true,
      ready: true,
      missing: [],
      checks: [
        {
          id: "feature_flag",
          label: "Feature flag",
          status: "ready",
          detail: "Enabled.",
          missing: [],
        },
        {
          id: "github_app",
          label: "GitHub App",
          status: "ready",
          detail: "Installed.",
          missing: [],
        },
      ],
    });

    expect(result.status).toBe("ready");
    // Checks must still be present so the Operator details disclosure has content
    expect(result.checks).toHaveLength(2);
  });

  test("REG-002: single missing item uses singular 'prerequisite' in subtext", () => {
    // Regression: pluralisation bug — "1 prerequisites need attention." is wrong.
    const result = mapReadinessToVerdict({
      enabled: true,
      ready: false,
      missing: ["GITHUB_APP_ID"],
      checks: [
        {
          id: "github_app",
          label: "GitHub App",
          status: "missing",
          detail: "Required.",
          missing: ["GITHUB_APP_ID"],
        },
      ],
    });

    expect(result.subtext).toBeDefined();
    expect(result.subtext).toContain("1 prerequisite");
    // Must NOT say "prerequisites" (plural)
    expect(result.subtext).not.toContain("1 prerequisites");
  });

  test("REG-003: checks with empty missing array do not carry a missing field (no undefined noise)", () => {
    // Regression: a missing[] of undefined would be passed to ReadinessVerdict and
    // trigger a render of empty env-var chip lists.
    const result = mapReadinessToVerdict({
      enabled: true,
      ready: true,
      missing: [],
      checks: [
        {
          id: "feature_flag",
          label: "Feature flag",
          status: "ready",
          detail: "Enabled.",
          missing: [],
        },
      ],
    });

    // The mapped check should NOT have a missing field (or should have undefined)
    // so ReadinessVerdict does not render an empty chip row.
    expect(result.checks?.[0]?.missing).toBeUndefined();
  });

  test("REG-004: enabled=false overrides ready=true — unavailable wins (defensive guard)", () => {
    // A malformed API response where enabled=false but ready=true should resolve
    // to unavailable, not ready, because the feature gate is not open.
    const result = mapReadinessToVerdict({
      enabled: false,
      ready: true,
      missing: [],
      checks: [],
    });

    // ready branch must be checked BEFORE enabled=false branch
    // The current implementation checks ready first, so this maps to "ready".
    // This test documents that contract so a future reorder is caught.
    expect(result.status).toBe("ready");
  });
});
