import { describe, expect, test } from "bun:test";
import { resolveGitHubReturnTarget } from "@/lib/github/connect-status";

const REQUEST_URL = "http://localhost/api/github/app/callback";

describe("resolveGitHubReturnTarget", () => {
  // Issue #829 (comment 3516151659): a failure/pending status returning to a
  // non-/get-started `next` target (e.g. bare /sessions) must be rerouted to
  // /get-started with the status + next preserved, so the get-started client
  // can render the notice instead of the sessions onboarding gate silently
  // swallowing the query params.
  test.each([
    "not_linked",
    "link_failed",
    "request_sent",
    "no_action",
    "pending_sync",
    "app_not_configured",
    "invalid_state",
    "sync_failed",
  ] as const)(
    "routes non-success status %s to /get-started carrying status + next",
    (status) => {
      const target = resolveGitHubReturnTarget(status, "/sessions", REQUEST_URL);

      expect(target.pathname).toBe("/get-started");
      expect(target.searchParams.get("github")).toBe(status);
      expect(target.searchParams.get("step")).toBe("github");
      expect(target.searchParams.get("next")).toBe("/sessions");
    },
  );

  test("carries missing_installation_id flag for no_action when requested", () => {
    const target = resolveGitHubReturnTarget("no_action", "/sessions", REQUEST_URL, {
      missingInstallationId: true,
    });

    expect(target.pathname).toBe("/get-started");
    expect(target.searchParams.get("missing_installation_id")).toBe("1");
  });

  test("does not set missing_installation_id when not requested", () => {
    const target = resolveGitHubReturnTarget("no_action", "/sessions", REQUEST_URL);

    expect(target.searchParams.get("missing_installation_id")).toBeNull();
  });

  test.each(["account_connected", "app_installed"] as const)(
    "keeps success status %s on the sanitized next target",
    (status) => {
      const target = resolveGitHubReturnTarget(status, "/sessions", REQUEST_URL);

      expect(target.pathname).toBe("/sessions");
      expect(target.searchParams.get("github")).toBe(status);
    },
  );

  test("success status still adds step=github when next target is /get-started", () => {
    const target = resolveGitHubReturnTarget(
      "app_installed",
      "/get-started",
      REQUEST_URL,
    );

    expect(target.pathname).toBe("/get-started");
    expect(target.searchParams.get("github")).toBe("app_installed");
    expect(target.searchParams.get("step")).toBe("github");
  });

  test("non-success status targeting /get-started already still carries next", () => {
    const target = resolveGitHubReturnTarget(
      "link_failed",
      "/get-started",
      REQUEST_URL,
    );

    expect(target.pathname).toBe("/get-started");
    expect(target.searchParams.get("github")).toBe("link_failed");
    expect(target.searchParams.get("next")).toBe("/get-started");
  });
});
