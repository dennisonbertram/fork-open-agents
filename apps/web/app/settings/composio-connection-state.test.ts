import { describe, expect, test } from "bun:test";
import {
  buildToolkitStatusMap,
  getToolkitConnectionState,
  isToolkitChipFlagged,
} from "./composio-connection-state";
import type { ComposioConnectedAccount } from "@/app/api/composio/connected-accounts/route";

function account(
  overrides: Partial<ComposioConnectedAccount> = {},
): ComposioConnectedAccount {
  return {
    id: "ca_1",
    toolkitSlug: "gmail",
    status: "ACTIVE",
    alias: null,
    ...overrides,
  };
}

describe("buildToolkitStatusMap", () => {
  test("maps each toolkit slug to its status", () => {
    const accounts: ComposioConnectedAccount[] = [
      account({ toolkitSlug: "gmail", status: "ACTIVE" }),
      account({ toolkitSlug: "slack", status: "EXPIRED" }),
    ];

    const map = buildToolkitStatusMap(accounts);
    expect(map.get("gmail")).toBe("ACTIVE");
    expect(map.get("slack")).toBe("EXPIRED");
    expect(map.has("notion")).toBe(false);
  });

  // Regression for the core reconnect scenario (Codex review, PR #826 P2-B):
  // a user reconnects an expired toolkit, so the account list now contains
  // BOTH the old EXPIRED account and the new ACTIVE one for the same slug.
  // The map must reflect the usable ACTIVE connection regardless of which
  // account the SDK happens to list first — response order must never
  // decide the UI state.
  test("multiple accounts for one slug: ACTIVE wins regardless of order — [EXPIRED, ACTIVE]", () => {
    const accounts: ComposioConnectedAccount[] = [
      account({ id: "ca_old", toolkitSlug: "slack", status: "EXPIRED" }),
      account({ id: "ca_new", toolkitSlug: "slack", status: "ACTIVE" }),
    ];

    const map = buildToolkitStatusMap(accounts);
    expect(map.get("slack")).toBe("ACTIVE");
  });

  test("multiple accounts for one slug: ACTIVE wins regardless of order — [ACTIVE, EXPIRED]", () => {
    const accounts: ComposioConnectedAccount[] = [
      account({ id: "ca_new", toolkitSlug: "slack", status: "ACTIVE" }),
      account({ id: "ca_old", toolkitSlug: "slack", status: "EXPIRED" }),
    ];

    const map = buildToolkitStatusMap(accounts);
    expect(map.get("slack")).toBe("ACTIVE");
  });

  test("multiple accounts for one slug, all EXPIRED -> 'EXPIRED' (no ACTIVE to prefer)", () => {
    const accounts: ComposioConnectedAccount[] = [
      account({ id: "ca_1", toolkitSlug: "slack", status: "EXPIRED" }),
      account({ id: "ca_2", toolkitSlug: "slack", status: "EXPIRED" }),
    ];

    const map = buildToolkitStatusMap(accounts);
    expect(map.get("slack")).toBe("EXPIRED");
  });

  test("multiple accounts for one slug, no ACTIVE/EXPIRED -> last non-priority status observed", () => {
    const accounts: ComposioConnectedAccount[] = [
      account({ id: "ca_1", toolkitSlug: "linear", status: "INITIATED" }),
      account({ id: "ca_2", toolkitSlug: "linear", status: "FAILED" }),
    ];

    const map = buildToolkitStatusMap(accounts);
    // Neither ACTIVE nor EXPIRED is present, so this falls outside the
    // priority rule — any non-ACTIVE, non-EXPIRED status is acceptable here,
    // but it must not silently become "ACTIVE" or disappear.
    const status = map.get("linear");
    expect(status).toBeDefined();
    expect(["INITIATED", "FAILED"]).toContain(status as string);
  });
});

describe("getToolkitConnectionState", () => {
  test("ACTIVE account -> 'active'", () => {
    const map = buildToolkitStatusMap([
      account({ toolkitSlug: "gmail", status: "ACTIVE" }),
    ]);
    expect(
      getToolkitConnectionState({
        slug: "gmail",
        statusMap: map,
        unavailable: false,
      }),
    ).toBe("active");
  });

  test("EXPIRED account -> 'expired' (never 'active', never silently absent)", () => {
    const map = buildToolkitStatusMap([
      account({ toolkitSlug: "slack", status: "EXPIRED" }),
    ]);
    expect(
      getToolkitConnectionState({
        slug: "slack",
        statusMap: map,
        unavailable: false,
      }),
    ).toBe("expired");
  });

  test("never-connected toolkit -> 'not_connected'", () => {
    const map = buildToolkitStatusMap([]);
    expect(
      getToolkitConnectionState({
        slug: "notion",
        statusMap: map,
        unavailable: false,
      }),
    ).toBe("not_connected");
  });

  test("any other non-ACTIVE/EXPIRED status (e.g. INITIATED, FAILED) -> 'other'", () => {
    const map = buildToolkitStatusMap([
      account({ toolkitSlug: "linear", status: "INITIATED" }),
    ]);
    expect(
      getToolkitConnectionState({
        slug: "linear",
        statusMap: map,
        unavailable: false,
      }),
    ).toBe("other");
  });

  test("fetch unavailable -> 'unavailable', overriding what would otherwise be not_connected", () => {
    const map = buildToolkitStatusMap([]);
    expect(
      getToolkitConnectionState({
        slug: "notion",
        statusMap: map,
        unavailable: true,
      }),
    ).toBe("unavailable");
  });

  test("fetch unavailable does NOT override a genuinely known ACTIVE status from a prior successful fetch", () => {
    const map = buildToolkitStatusMap([
      account({ toolkitSlug: "gmail", status: "ACTIVE" }),
    ]);
    expect(
      getToolkitConnectionState({
        slug: "gmail",
        statusMap: map,
        unavailable: true,
      }),
    ).toBe("active");
  });
});

// Regression for Codex review, PR #826 P2-A: a selected chip must only be
// flagged (amber "problem" styling) when it actually needs attention.
// "active" is a healthy, working connection and must render unflagged, even
// though it's still a non-null connection state.
describe("isToolkitChipFlagged", () => {
  test("'active' state is NOT flagged", () => {
    expect(
      isToolkitChipFlagged({ unknown: false, connectionState: "active" }),
    ).toBe(false);
  });

  test("'expired' state IS flagged", () => {
    expect(
      isToolkitChipFlagged({ unknown: false, connectionState: "expired" }),
    ).toBe(true);
  });

  test("'not_connected' state IS flagged", () => {
    expect(
      isToolkitChipFlagged({
        unknown: false,
        connectionState: "not_connected",
      }),
    ).toBe(true);
  });

  test("'other' state IS flagged", () => {
    expect(
      isToolkitChipFlagged({ unknown: false, connectionState: "other" }),
    ).toBe(true);
  });

  test("'unavailable' state IS flagged", () => {
    expect(
      isToolkitChipFlagged({ unknown: false, connectionState: "unavailable" }),
    ).toBe(true);
  });

  test("unknown (legacy) slug IS flagged regardless of connectionState", () => {
    expect(isToolkitChipFlagged({ unknown: true, connectionState: null })).toBe(
      true,
    );
  });

  test("null connectionState (e.g. noAuth toolkit) is NOT flagged", () => {
    expect(
      isToolkitChipFlagged({ unknown: false, connectionState: null }),
    ).toBe(false);
  });
});

// Regression: the full reconnect scenario end to end, composing all three
// helpers exactly as composio-toolkit-picker.tsx does. This is the scenario
// PR #826's Codex review (P2-A + P2-B) was filed against: a user reconnects
// an expired Slack account, so the SDK's connected-accounts response now
// contains both the stale EXPIRED account and the new ACTIVE one. If either
// fix were reverted, this test fails:
// - revert P2-B (buildToolkitStatusMap priority): the map keeps whichever
//   status was written last, so with the SDK returning the old EXPIRED
//   account after the new ACTIVE one, the derived state regresses to
//   "expired" and the chip is wrongly flagged.
// - revert P2-A (isToolkitChipFlagged): even with the correct "active"
//   state, the old `Boolean(connectionState)` check would still flag the
//   chip as a warning.
describe("regression: reconnect scenario (EXPIRED + ACTIVE for one slug)", () => {
  test("resolves to 'active' and is NOT flagged, regardless of SDK response order", () => {
    const responseOrders: ComposioConnectedAccount[][] = [
      [
        account({ id: "ca_old", toolkitSlug: "slack", status: "EXPIRED" }),
        account({ id: "ca_new", toolkitSlug: "slack", status: "ACTIVE" }),
      ],
      [
        account({ id: "ca_new", toolkitSlug: "slack", status: "ACTIVE" }),
        account({ id: "ca_old", toolkitSlug: "slack", status: "EXPIRED" }),
      ],
    ];

    for (const accounts of responseOrders) {
      const statusMap = buildToolkitStatusMap(accounts);
      const connectionState = getToolkitConnectionState({
        slug: "slack",
        statusMap,
        unavailable: false,
      });

      expect(connectionState).toBe("active");
      expect(isToolkitChipFlagged({ unknown: false, connectionState })).toBe(
        false,
      );
    }
  });
});
