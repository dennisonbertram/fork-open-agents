/**
 * Regression test for the agent-builder "Other tools" settings link fix
 * (#801, epic #796 T5, finding G7). Would fail if the implementation from
 * 64053972 were reverted, sending users back to the wrong
 * /settings/background-agents page instead of /settings/composio.
 *
 * This is a source-level check (stronger than the rendered-markup assertion
 * in composio-other-tools-section.test.tsx) — it scans the raw file for the
 * literal wrong path string anywhere at all, catching a reintroduction via
 * a different prop, a new Link, or copy elsewhere in the file.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("regression: composio-other-tools-section.tsx never references the wrong settings path", () => {
  test("source contains no occurrence of '/settings/background-agents'", () => {
    const source = readFileSync(
      new URL("composio-other-tools-section.tsx", import.meta.url),
      "utf-8",
    );
    expect(source).not.toContain("/settings/background-agents");
  });

  test("source references the correct '/settings/composio' path", () => {
    const source = readFileSync(
      new URL("composio-other-tools-section.tsx", import.meta.url),
      "utf-8",
    );
    expect(source).toContain("/settings/composio");
  });
});
