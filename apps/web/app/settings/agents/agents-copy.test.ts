/**
 * Unit tests for agents-copy.ts — plain-language copy reconciling the
 * "External tools: None connected" field with the fact that Composio
 * profiles may already exist elsewhere in the account (#803 item 5, W4).
 *
 * RED commit: fails because agents-copy.ts doesn't exist yet.
 *
 * Codex review on PR #851 (P2-1) found the original hint told users to
 * "assign one here" — but this page's editor (agents-section.tsx) only
 * exposes a toolkit picker writing composioToolkitSlugs; there is no
 * profile-selector control on this page, so "assign one here" pointed at a
 * recovery action that does not exist on this surface. Verified: the only
 * UI that writes a per-role default profile is the "Agent defaults" picker
 * on Settings -> Composio (composio-section.tsx, defaultProfileId). The
 * corrected copy below points there instead of at "here".
 */
import { describe, expect, test } from "bun:test";
import {
  EXTERNAL_TOOLS_NONE_ASSIGNED_HINT,
  EXTERNAL_TOOLS_NONE_ASSIGNED_LABEL,
} from "./agents-copy";

describe("External tools 'none assigned' copy (#803 item 5, W4)", () => {
  test("BT-803-005a label says 'assigned to this agent', not just 'connected'", () => {
    expect(EXTERNAL_TOOLS_NONE_ASSIGNED_LABEL).toBe(
      "None assigned to this agent",
    );
  });

  test("BT-803-005b hint points at what this page can actually do (pick tools directly), not a nonexistent profile picker here", () => {
    expect(EXTERNAL_TOOLS_NONE_ASSIGNED_HINT).toMatch(/pick tools directly/i);
    expect(EXTERNAL_TOOLS_NONE_ASSIGNED_HINT).not.toMatch(/assign one here/i);
  });

  test("BT-803-005c hint points to Settings -> Composio's Agent defaults as where a default profile IS assignable", () => {
    expect(EXTERNAL_TOOLS_NONE_ASSIGNED_HINT).toMatch(
      /settings.*composio.*agent defaults/i,
    );
  });
});
