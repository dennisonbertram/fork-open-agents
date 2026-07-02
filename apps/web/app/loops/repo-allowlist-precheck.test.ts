/**
 * repo-allowlist-precheck.test.ts (#767)
 *
 * Pure mapping from a GET /api/agent-loops/readiness?owner=&repo= response
 * to the create-form's blocking message. Extracted so the create form can
 * precheck the repo allowlist before submit and show
 * "This repository isn't enabled for loops on this deployment." instead of
 * deferring to a first-run 403.
 */

import { describe, expect, it } from "bun:test";
import { getRepoAllowlistBlockMessage } from "./repo-allowlist-precheck";

describe("getRepoAllowlistBlockMessage", () => {
  it("returns null when the repo_access check is ready", () => {
    const message = getRepoAllowlistBlockMessage({
      enabled: true,
      checks: [
        {
          id: "repo_access",
          label: "This repository",
          status: "ready",
          detail: "acme/widgets is enabled for loops on this deployment.",
          missing: [],
        },
      ],
    });
    expect(message).toBeNull();
  });

  it("returns the blocking message when repo_access is disabled", () => {
    const message = getRepoAllowlistBlockMessage({
      enabled: true,
      checks: [
        {
          id: "repo_access",
          label: "This repository",
          status: "disabled",
          detail: "acme/widgets isn't enabled for loops on this deployment.",
          missing: ["AGENT_LOOPS_ALLOWED_REPOS"],
        },
      ],
    });
    expect(message).toBe(
      "This repository isn't enabled for loops on this deployment.",
    );
  });

  it("returns null when there's no repo_access check at all (readiness called without owner/repo)", () => {
    const message = getRepoAllowlistBlockMessage({
      enabled: true,
      checks: [
        {
          id: "feature_flag",
          label: "Feature flag",
          status: "ready",
          detail: "",
          missing: [],
        },
      ],
    });
    expect(message).toBeNull();
  });
});
