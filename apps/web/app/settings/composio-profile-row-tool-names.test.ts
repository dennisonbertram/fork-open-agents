/**
 * Unit tests for profileRowToolNamesText — the pure helper that renders a
 * profile row's tool names as visible text (#803 item 8, W3), so a screen
 * reader user and a sighted user scanning quickly both see tool names, not
 * only logo icons.
 *
 * RED commit: these tests fail because profileRowToolNamesText doesn't
 * exist yet.
 */
import { describe, expect, test } from "bun:test";
import { profileRowToolNamesText } from "./composio-section-helpers";

describe("profileRowToolNamesText (#803 item 8, W3)", () => {
  test("BT-803-008a returns 'No tools' text for an empty profile", () => {
    expect(profileRowToolNamesText([])).toBe("No tools");
  });

  test("BT-803-008b returns prettified tool names as visible text", () => {
    expect(profileRowToolNamesText(["gmail"])).toBe("Gmail");
    expect(profileRowToolNamesText(["gmail", "slack"])).toBe("Gmail, Slack");
  });

  test("BT-803-008c truncates with a +N more suffix beyond 3 tools", () => {
    expect(
      profileRowToolNamesText(["gmail", "slack", "linear", "notion"]),
    ).toBe("Gmail, Slack, Linear +1 more");
  });
});
