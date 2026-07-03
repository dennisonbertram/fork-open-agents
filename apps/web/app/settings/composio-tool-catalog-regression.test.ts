/**
 * Regression tests for composio-tool-catalog.tsx's honest-connect source
 * contract (#801, epic #796 T5, finding C1). Would fail if the
 * implementation from 64053972 were reverted to reintroduce the optimistic
 * `toast.success("Finish connecting in the new tab, then refresh")` call
 * that previously fired before any OAuth callback had happened.
 *
 * This is a source-level check (not just "no toast.success substring", which
 * composio-tool-catalog.test.tsx already asserts) — it additionally proves
 * `sonner` isn't imported at all anymore, so a future refactor that renames
 * the call (e.g. `toast.info(...)`) instead of removing the dependency
 * entirely is still caught.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("regression: composio-tool-catalog.tsx no longer depends on sonner", () => {
  test("source has no 'sonner' import at all — the optimistic toast dependency is fully removed", () => {
    const source = readFileSync(
      new URL("composio-tool-catalog.tsx", import.meta.url),
      "utf-8",
    );
    expect(source).not.toContain('from "sonner"');
  });

  test("source wires useComposioConnect for the connect flow instead of an inline fetch+window.open+toast handler", () => {
    const source = readFileSync(
      new URL("composio-tool-catalog.tsx", import.meta.url),
      "utf-8",
    );
    expect(source).toContain("useComposioConnect");
  });
});
