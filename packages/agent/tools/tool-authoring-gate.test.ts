/**
 * Tests for Phase 6: policy gate wiring in open-agent getRuntimeModeToolPolicy.
 *
 * BT-010: getRuntimeModeToolPolicyWithAuthoring with toolAuthoringEnabled=false
 *         does NOT include propose_composio_tool in the returned toolset
 * BT-011: getRuntimeModeToolPolicyWithAuthoring with toolAuthoringEnabled=true
 *         DOES include propose_composio_tool
 * REGRESSION: default call (no toolAuthoringEnabled) omits the tool — existing
 *             agents are unaffected by Phase 6.
 */

import { describe, expect, it, mock } from "bun:test";

// ── Mock ai module ─────────────────────────────────────────────────────────────
mock.module("ai", () => {
  class MockToolLoopAgent {
    readonly config: unknown;
    constructor(config: unknown) { this.config = config; }
  }
  const createGateway = () => (modelId: string) => ({ modelId });
  return {
    createGateway,
    defaultSettingsMiddleware: (settings: unknown) => settings,
    gateway: createGateway,
    getToolName: (part: { toolName?: string; type?: string }) => {
      if (part.toolName) return part.toolName;
      if (typeof part.type === "string" && part.type.startsWith("tool-")) return part.type.slice(5);
      return "";
    },
    isToolUIPart: (part: unknown) => {
      if (!part || typeof part !== "object") return false;
      const candidate = part as { type?: unknown };
      return typeof candidate.type === "string" && candidate.type.startsWith("tool-");
    },
    stepCountIs: (count: number) => ({ count }),
    ToolLoopAgent: MockToolLoopAgent,
    tool: <T extends Record<string, unknown>>(def: T) => def,
    wrapLanguageModel: ({ model }: { model: unknown }) => model,
  };
});

const { getRuntimeModeToolPolicy, OPEN_AGENT_TOOL_NAMES } = await import("../open-agent");
const { PROPOSE_TOOL_NAME } = await import("./propose-tool");

describe("tool authoring gate in runtime tool policy", () => {
  // BT-010: disabled => tool absent
  it("does NOT include propose_composio_tool when toolAuthoringEnabled is false", () => {
    const toolset = getRuntimeModeToolPolicy("classic", undefined, { toolAuthoringEnabled: false });
    expect(Object.keys(toolset)).not.toContain(PROPOSE_TOOL_NAME);
  });

  // BT-011: enabled => tool present
  it("includes propose_composio_tool when toolAuthoringEnabled is true", () => {
    const toolset = getRuntimeModeToolPolicy("classic", undefined, { toolAuthoringEnabled: true });
    expect(Object.keys(toolset)).toContain(PROPOSE_TOOL_NAME);
  });

  // REGRESSION: default call (no toolAuthoringEnabled option) must NOT include the tool
  it("regression: default call with no toolAuthoringEnabled omits the authoring tool", () => {
    const toolset = getRuntimeModeToolPolicy("classic");
    expect(Object.keys(toolset)).not.toContain(PROPOSE_TOOL_NAME);
  });

  // REGRESSION: existing tool names are unchanged when toolAuthoringEnabled=false
  it("regression: all existing OPEN_AGENT_TOOL_NAMES are preserved in classic mode when authoring is disabled", () => {
    const toolset = getRuntimeModeToolPolicy("classic", undefined, { toolAuthoringEnabled: false });
    for (const name of OPEN_AGENT_TOOL_NAMES) {
      expect(Object.keys(toolset)).toContain(name);
    }
  });

  // REGRESSION: sandbox-free mode does NOT expose the authoring tool regardless of flag
  it("regression: sandbox-free mode does not include authoring tool even when toolAuthoringEnabled=true", () => {
    const toolset = getRuntimeModeToolPolicy("classic", undefined, {
      sandboxFree: true,
      toolAuthoringEnabled: true,
    });
    expect(Object.keys(toolset)).not.toContain(PROPOSE_TOOL_NAME);
  });
});
