import { describe, expect, test } from "bun:test";
import {
  buildToolkitStatusMap,
  getToolkitConnectionState,
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
