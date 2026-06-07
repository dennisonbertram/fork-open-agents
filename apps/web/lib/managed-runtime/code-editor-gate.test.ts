import { describe, expect, test } from "bun:test";
import { getCodeEditorDisabledReason } from "./code-editor-gate";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";

function makeProfile(
  overrides: Partial<Pick<ManagedRuntimeProfile, "id" | "expectedTools" | "optionalTools">>,
): ManagedRuntimeProfile {
  return {
    id: "test-profile",
    version: "1.0.0",
    displayName: "Test Profile",
    description: "A test profile",
    setupCommands: [],
    verificationCommands: [],
    expectedTools: [],
    optionalTools: [],
    defaultPorts: [3000],
    ...overrides,
  };
}

describe("getCodeEditorDisabledReason", () => {
  // BT-001: Profile without code-server in expected or optional tools returns non-null reason
  test("returns a non-null disabled reason when the profile does not include code-server", () => {
    const profile = makeProfile({
      id: "web-bun-agent-browser",
      expectedTools: ["bun", "agent-browser"],
      optionalTools: ["node", "npm"],
    });

    const reason = getCodeEditorDisabledReason(profile);

    expect(reason).not.toBeNull();
    expect(typeof reason).toBe("string");
    expect(reason!.length).toBeGreaterThan(0);
  });

  // BT-002: Profile with code-server in expectedTools returns null (editor allowed)
  test("returns null when the profile lists code-server in expectedTools", () => {
    const profile = makeProfile({
      id: "web-bun-code-server",
      expectedTools: ["bun", "code-server"],
      optionalTools: [],
    });

    const reason = getCodeEditorDisabledReason(profile);

    expect(reason).toBeNull();
  });

  // BT-003: Profile with code-server in optionalTools returns null (editor allowed)
  test("returns null when the profile lists code-server in optionalTools", () => {
    const profile = makeProfile({
      id: "web-bun-code-server-optional",
      expectedTools: ["bun"],
      optionalTools: ["code-server"],
    });

    const reason = getCodeEditorDisabledReason(profile);

    expect(reason).toBeNull();
  });

  // BT-004: Default web-bun-agent-browser profile always produces a disabled reason
  test("default web-bun-agent-browser profile produces a disabled reason describing the missing tool", () => {
    const profile = makeProfile({
      id: "web-bun-agent-browser",
      expectedTools: ["bun", "agent-browser"],
      optionalTools: ["node", "npm"],
    });

    const reason = getCodeEditorDisabledReason(profile);

    expect(reason).not.toBeNull();
    // The reason should mention the runtime profile or code editor
    expect(reason!.toLowerCase()).toMatch(/profile|editor/);
  });
});
