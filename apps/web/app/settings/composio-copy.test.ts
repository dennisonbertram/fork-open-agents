/**
 * Unit tests for composio-copy.ts — plain-language, honest copy strings
 * for the Composio settings surfaces (#803, epic #796 T7).
 *
 * These are pure string constants, extracted so the copy is locked by a
 * test independent of React rendering. RED commit: these tests fail
 * because composio-copy.ts doesn't exist yet.
 *
 * Codex review on PR #851 (P2-2) found the original TOOL_PROFILES_DESCRIPTION
 * claimed background agents and loops "use those tools automatically" via a
 * profile. Verified against the code: background-agents/executor.ts resolves
 * only agent.composioToolkitSlugs (line ~1104), and agent-loops/agent-step.ts
 * resolves only node.composioToolkitSlugs (line ~530) — neither consults a
 * Composio profile at all. Profiles are consumed only by the CHAT path
 * (lib/composio/session.ts -> resolveComposioSlugsForChatMain, which reads
 * agentRow.composioProfileId as a chat-only fallback tier). The corrected
 * copy below describes profiles as chat-usable (via per-chat selection or an
 * agent-row default) and states plainly that background agents/loops pick
 * toolkits directly on their own editor instead.
 */
import { describe, expect, test } from "bun:test";
import {
  BRING_YOUR_OWN_AUTH_EXPLAINER,
  BRING_YOUR_OWN_AUTH_TITLE,
  EMPTY_TOOL_PROFILES_TEXT,
  TOOL_PROFILES_DESCRIPTION,
} from "./composio-copy";

describe("TOOL_PROFILES_DESCRIPTION (#803 item 2)", () => {
  test("BT-803-002 describes profiles as chat-usable, not something background agents/loops consume automatically", () => {
    expect(TOOL_PROFILES_DESCRIPTION).toMatch(/chat/i);
    // Must NOT claim background agents/loops use a PROFILE automatically —
    // they only consult toolkit slugs set directly on their own editor.
    expect(TOOL_PROFILES_DESCRIPTION).not.toMatch(
      /background agents and loops use those tools automatically/i,
    );
  });

  test("BT-803-002b explains background agents and loops pick toolkits directly on their own editor instead", () => {
    expect(TOOL_PROFILES_DESCRIPTION).toMatch(/background agents/i);
    expect(TOOL_PROFILES_DESCRIPTION).toMatch(/loops/i);
    expect(TOOL_PROFILES_DESCRIPTION).toMatch(
      /pick toolkits directly|choose toolkits directly/i,
    );
  });

  test("BT-803-002c names example external tools in plain language", () => {
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
