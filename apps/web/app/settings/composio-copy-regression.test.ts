/**
 * Regression tests for composio-copy.ts (#803).
 *
 * These catch future breakage if the copy is silently reverted to the old
 * jargon-heavy or chat-only strings that motivated this ticket.
 *
 * Regression commit: linked to green 2bb8b9a9.
 */
import { describe, expect, test } from "bun:test";
import {
  BRING_YOUR_OWN_AUTH_TITLE,
  EMPTY_TOOL_PROFILES_TEXT,
  TOOL_PROFILES_DESCRIPTION,
} from "./composio-copy";
import { getSettingsRouteMetadata } from "./settings-routes";

describe("composio copy — regression", () => {
  test("REGRESSION-001 tool-profiles description no longer says 'in a chat' as the only usage path", () => {
    // The old string implied chats were the only place tools mattered.
    // The new copy must describe agent/loop usage explicitly.
    expect(TOOL_PROFILES_DESCRIPTION).not.toMatch(
      /so different agents get different tools — or pick tools directly in a chat\.$/,
    );
    expect(TOOL_PROFILES_DESCRIPTION.toLowerCase()).toContain(
      "background agents",
    );
  });

  test("REGRESSION-002 empty tool-profiles state is not the bare old one-liner", () => {
    expect(EMPTY_TOOL_PROFILES_TEXT).not.toBe(
      "No tool profiles yet. Create one to bundle tools for an agent.",
    );
  });

  test("REGRESSION-003 bring-your-own-auth title no longer uses unexplained 'auth' jargon alone", () => {
    expect(BRING_YOUR_OWN_AUTH_TITLE).not.toBe(
      "Bring your own auth (advanced)",
    );
    expect(BRING_YOUR_OWN_AUTH_TITLE.toLowerCase()).toContain("credentials");
  });

  test("REGRESSION-004 settings-routes composio description no longer says 'in a chat' only", () => {
    const meta = getSettingsRouteMetadata("composio");
    expect(meta.description).not.toBe(
      "Connect external tools so your agents can use them in a chat.",
    );
  });
});
