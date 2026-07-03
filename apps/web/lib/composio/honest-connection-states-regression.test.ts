/**
 * Regression coverage for issue #800 (honest Composio connection states).
 *
 * Each test here is written so it would FAIL if the corresponding fix were
 * reverted — pinning the specific behaviors that are easy to silently
 * regress (an SDK-level statuses filter creeping back in, the double-wrap
 * bug creeping back into getSetupErrorMessage, or errorKind values drifting
 * back to their pre-#800 names).
 */
import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

describe("regression: shared connected-accounts helper never re-adds an ACTIVE-only SDK filter", () => {
  test("listComposioConnectedAccounts surfaces an EXPIRED account even when an ACTIVE account for a different toolkit also exists", async () => {
    const { listComposioConnectedAccounts } =
      await import("./connected-accounts");

    const composio = {
      connectedAccounts: {
        list: mock(async () => ({
          items: [
            { id: "ca_active", status: "ACTIVE", toolkit: { slug: "gmail" } },
            {
              id: "ca_expired",
              status: "EXPIRED",
              toolkit: { slug: "slack" },
            },
          ],
        })),
      },
    };

    const accounts = await listComposioConnectedAccounts({
      composio,
      userId: "user-1",
    });

    // Before #800, session.ts/composio-tools.ts/the route each requested
    // `statuses: ["ACTIVE"]` from the SDK, so an EXPIRED account would never
    // even reach application code — it would silently look identical to
    // "never connected". This must not regress.
    const slack = accounts.find((a) => a.toolkitSlug === "slack");
    expect(slack).toBeDefined();
    expect(slack?.status).toBe("EXPIRED");

    // Confirm the SDK call itself carries no statuses filter (the actual
    // mechanism that would silently drop EXPIRED accounts if reintroduced).
    const callArgs = (
      composio.connectedAccounts.list as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArgs?.statuses).toBeUndefined();
  });
});

describe("regression: getComposioErrorKind taxonomy uses the composio_ prefixed names", () => {
  test("does not regress to the old bare kind names (missing_api_key, invalid_api_key, unreachable, unknown)", async () => {
    const { getComposioErrorKind } = await import("./errors");

    const cases: Array<{ message: string; expectedPrefix: string }> = [
      {
        message: "COMPOSIO_API_KEY is not configured",
        expectedPrefix: "composio_",
      },
      { message: "Invalid API key: ak_x", expectedPrefix: "composio_" },
      { message: "Composio is unreachable", expectedPrefix: "composio_" },
      { message: "totally unclassified", expectedPrefix: "composio_" },
    ];

    for (const { message, expectedPrefix } of cases) {
      const kind = getComposioErrorKind(new Error(message));
      expect(kind.startsWith(expectedPrefix)).toBe(true);
    }
  });
});

describe("regression: double-wrap fix survives a real ComposioSetupError round-trip", () => {
  test("a repo-policy-blocked ComposioSetupError message is never re-wrapped with 'Fix the Composio setup' generic copy", async () => {
    const { getComposioUserFacingError } = await import("./errors");

    // This exact message shape is produced by isComposioProfileAllowedForRepository
    // in lib/db/composio.ts. Before the #800 fix, any message that fell through
    // to the "unknown" classification (which this one did, since there was no
    // composio_repo_policy_blocked branch pre-#800) got wrapped in generic
    // "Composio tools could not start: ... Fix the Composio setup..." copy.
    const message = "Blocked toolkit for this repository: gmail.";

    const result = getComposioUserFacingError(new Error(message));

    expect(result).toBe(message);
    expect(result).not.toContain("Fix the Composio setup");
  });
});
