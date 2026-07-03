/**
 * Unit tests for agents-copy.ts — plain-language copy reconciling the
 * "External tools: None connected" field with the fact that Composio
 * profiles may already exist elsewhere in the account (#803 item 5, W4).
 *
 * RED commit: fails because agents-copy.ts doesn't exist yet.
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

  test("BT-803-005b hint explains profiles existing elsewhere isn't the same as being assigned here", () => {
    expect(EXTERNAL_TOOLS_NONE_ASSIGNED_HINT).toMatch(
      /aren't used until you assign/i,
    );
    expect(EXTERNAL_TOOLS_NONE_ASSIGNED_HINT).toMatch(/settings.*composio/i);
  });
});
