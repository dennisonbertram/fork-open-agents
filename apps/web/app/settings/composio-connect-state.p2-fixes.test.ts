/**
 * Tests for two Codex P2 findings on PR #847 (issue #801, epic #796 T5).
 *
 * P2-1 (composio-tool-catalog.tsx's CatalogErrorState "Retry" button): the
 * Retry button was wired to `mutateAccounts()` — the
 * `/api/composio/connected-accounts` SWR mutator — instead of revalidating
 * the actually-failed `/api/composio/toolkits` catalog fetch. Clicking Retry
 * left the error on screen until an unrelated accounts revalidation
 * happened to also refresh the toolkits cache. Fixed by having
 * `useComposioToolkitsCatalog` expose its own `mutate`, and wiring
 * `CatalogErrorState`'s `onRetry` to call both the catalog mutator and the
 * accounts mutator (retrying is reasonably expected to refresh both, since
 * either fetch failing produces the visible error branches on this page).
 *
 * This repo's test setup has no DOM/testing-library, so the `onRetry` wiring
 * itself is proven at the pure state-derivation level: `deriveCatalogLoadState`
 * (already existing) tells the UI when to show the retry button; this file
 * proves the NEW pure helper `isTerminalConnectFailure` used to decide when
 * a terminal connect state must be paired with a restored connect
 * affordance (P2-2), and documents (BT-801-P2-1-xxx) the retry-wiring
 * contract via a source-level assertion since the mutate call itself has no
 * pure-function seam (it's a direct SWR mutate invocation).
 *
 * P2-2 (composio-tool-catalog.tsx's ToolkitCard/ConnectProgress): terminal
 * connect failures (blocked / timed_out / failed_to_start) rendered ONLY the
 * failure copy — the Connect/Reconnect button never came back, so "try
 * again" copy had nothing to click. Fixed via `isTerminalConnectFailure`,
 * used by the card to know when to render the normal
 * connectionState-driven CTA (Connect/Reconnect) alongside the failure copy
 * instead of suppressing it.
 *
 * BT-801-P2-2-001: "blocked" is a terminal failure — the card must show an
 *                  actionable connect affordance again.
 * BT-801-P2-2-002: "timed_out" is a terminal failure — same requirement.
 * BT-801-P2-2-003: "failed_to_start" is a terminal failure — same
 *                  requirement.
 * BT-801-P2-2-004: "connecting" and "pending" are NOT terminal failures —
 *                  the card must NOT show a duplicate Connect button while
 *                  a connect attempt is genuinely in flight (that would let
 *                  a user fire a second overlapping connect attempt).
 */
import { describe, expect, test } from "bun:test";
import { isTerminalConnectFailure } from "./composio-connect-state";
import { readFileSync } from "node:fs";

describe("isTerminalConnectFailure — restores the connect affordance after a terminal failure (P2-2)", () => {
  test("BT-801-P2-2-001: 'blocked' is a terminal failure", () => {
    expect(isTerminalConnectFailure("blocked")).toBe(true);
  });

  test("BT-801-P2-2-002: 'timed_out' is a terminal failure", () => {
    expect(isTerminalConnectFailure("timed_out")).toBe(true);
  });

  test("BT-801-P2-2-003: 'failed_to_start' is a terminal failure", () => {
    expect(isTerminalConnectFailure("failed_to_start")).toBe(true);
  });

  test("BT-801-P2-2-004: 'connecting' and 'pending' are not terminal failures", () => {
    expect(isTerminalConnectFailure("connecting")).toBe(false);
    expect(isTerminalConnectFailure("pending")).toBe(false);
  });

  test("BT-801-P2-2-005: 'confirmed' and 'idle' are not terminal failures", () => {
    expect(isTerminalConnectFailure("confirmed")).toBe(false);
    expect(isTerminalConnectFailure("idle")).toBe(false);
  });
});

describe("regression: composio-tool-catalog.tsx's Retry button targets the toolkits catalog mutator (P2-1)", () => {
  test("source calls the catalog's own mutate (not only mutateAccounts) from CatalogErrorState's onRetry", () => {
    const source = readFileSync(
      new URL("composio-tool-catalog.tsx", import.meta.url),
      "utf-8",
    );
    // The fix destructures a catalog-specific mutate (e.g. mutateToolkits)
    // from useComposioToolkitsCatalog and calls it from onRetry — proving
    // the retry path is no longer wired exclusively to mutateAccounts.
    expect(source).toContain("mutateToolkits");

    // onRetry's JSX prop opens a multi-line arrow function body, so scan a
    // window of lines starting at the `onRetry=` line rather than requiring
    // the mutate call on that exact line.
    const lines = source.split("\n");
    const onRetryIndex = lines.findIndex((line) => line.includes("onRetry="));
    expect(onRetryIndex).toBeGreaterThan(-1);
    const onRetryBody = lines.slice(onRetryIndex, onRetryIndex + 8).join("\n");
    expect(onRetryBody).toContain("mutateToolkits");
  });
});

describe("regression: composio-tool-catalog.tsx restores a connect affordance after a terminal failure (P2-2)", () => {
  test("source wires isTerminalConnectFailure into the card's CTA rendering", () => {
    const source = readFileSync(
      new URL("composio-tool-catalog.tsx", import.meta.url),
      "utf-8",
    );
    expect(source).toContain("isTerminalConnectFailure");
  });
});
