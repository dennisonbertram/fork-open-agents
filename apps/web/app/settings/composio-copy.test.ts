/**
 * Unit tests for composio-copy.ts — plain-language, honest copy strings
 * for the Composio settings surfaces (#803, epic #796 T7).
 *
 * These are pure string constants, extracted so the copy is locked by a
 * test independent of React rendering. RED commit: these tests fail
 * because composio-copy.ts doesn't exist yet.
 */
import { describe, expect, test } from "bun:test";
import {
  BRING_YOUR_OWN_AUTH_EXPLAINER,
  BRING_YOUR_OWN_AUTH_TITLE,
  EMPTY_TOOL_PROFILES_TEXT,
  TOOL_PROFILES_DESCRIPTION,
} from "./composio-copy";

describe("TOOL_PROFILES_DESCRIPTION (#803 item 2)", () => {
  test("BT-803-002 explains profiles are used by background agents and loops, not just a chat", () => {
    expect(TOOL_PROFILES_DESCRIPTION).toMatch(/background agents/i);
    expect(TOOL_PROFILES_DESCRIPTION).toMatch(/loops/i);
  });

  test("BT-803-002b names example external tools in plain language", () => {
    expect(TOOL_PROFILES_DESCRIPTION).toMatch(/gmail/i);
    expect(TOOL_PROFILES_DESCRIPTION).toMatch(/slack/i);
  });
});

describe("EMPTY_TOOL_PROFILES_TEXT (#803 item 3)", () => {
  test("BT-803-003 explains what creating a profile does, not just 'bundle tools for an agent'", () => {
    expect(EMPTY_TOOL_PROFILES_TEXT).toMatch(/no tool profiles yet/i);
    expect(EMPTY_TOOL_PROFILES_TEXT).toMatch(/gmail|slack/i);
    expect(EMPTY_TOOL_PROFILES_TEXT).toMatch(
      /hand.*to an agent|pick.*in a chat/i,
    );
  });
});

describe("Bring your own auth copy (#803 item 4)", () => {
  test("BT-803-004a title replaces unexplained 'auth' jargon with plain language", () => {
    expect(BRING_YOUR_OWN_AUTH_TITLE).toMatch(/your own login credentials/i);
    expect(BRING_YOUR_OWN_AUTH_TITLE).toMatch(/advanced/i);
  });

  test("BT-803-004b explainer states the plain-language tradeoff (Composio's shared connection vs your own account)", () => {
    expect(BRING_YOUR_OWN_AUTH_EXPLAINER).toMatch(/composio/i);
    expect(BRING_YOUR_OWN_AUTH_EXPLAINER).toMatch(/your own/i);
  });
});
