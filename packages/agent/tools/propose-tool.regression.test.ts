/**
 * Regression tests for Phase 6: policy-gated propose_composio_tool.
 *
 * These tests catch regressions if:
 * - The tool authoring gate is removed or weakened (tool appears for default agents)
 * - The tool appears in sandbox-free mode even when enabled
 * - The managed-runtime coordinator policy leaks the tool
 * - The tool name constant changes (breaks caller code that checks for it)
 */

import { describe, expect, it, mock } from "bun:test";

// ── Mock ai module ─────────────────────────────────────────────────────────────
mock.module("ai", () => {
  class MockToolLoopAgent {
    readonly config: unknown;
    constructor(config: unknown) {
      this.config = config;
    }
  }
  const createGateway = () => (modelId: string) => ({ modelId });
  return {
    createGateway,
    defaultSettingsMiddleware: (settings: unknown) => settings,
    gateway: createGateway,
    getToolName: (part: { toolName?: string; type?: string }) => {
      if (part.toolName) return part.toolName;
      if (typeof part.type === "string" && part.type.startsWith("tool-"))
        return part.type.slice(5);
      return "";
    },
    isToolUIPart: (part: unknown) => {
      if (!part || typeof part !== "object") return false;
      const candidate = part as { type?: unknown };
      return (
        typeof candidate.type === "string" && candidate.type.startsWith("tool-")
      );
    },
    stepCountIs: (count: number) => ({ count }),
    ToolLoopAgent: MockToolLoopAgent,
    tool: <T extends Record<string, unknown>>(def: T) => def,
    wrapLanguageModel: ({ model }: { model: unknown }) => model,
  };
});

const { getRuntimeModeToolPolicy, OPEN_AGENT_TOOL_NAMES } =
  await import("../open-agent");
const { PROPOSE_TOOL_NAME } = await import("./propose-tool");

describe("Phase 6 regressions", () => {
  // REGRESSION-1: default agents (no toolAuthoringEnabled) have no authoring tool
  // Catches: If the gate condition is accidentally inverted or removed
  it("default agent toolset (no options) does not include the authoring tool", () => {
    const toolset = getRuntimeModeToolPolicy("classic");
    expect(Object.keys(toolset)).not.toContain(PROPOSE_TOOL_NAME);
  });

  // REGRESSION-2: OPEN_AGENT_TOOL_NAMES does NOT include the authoring tool
  // Catches: If someone accidentally adds propose_composio_tool to the base list
  it("OPEN_AGENT_TOOL_NAMES does not include the authoring tool (it is gated, not base)", () => {
    expect(OPEN_AGENT_TOOL_NAMES).not.toContain(PROPOSE_TOOL_NAME);
  });

  // REGRESSION-3: sandbox-free mode never includes the authoring tool
  // Catches: If the sandbox-free path is modified to also inject authoring tools
  it("sandbox-free mode excludes the authoring tool even when toolAuthoringEnabled=true", () => {
    const toolset = getRuntimeModeToolPolicy("classic", undefined, {
      sandboxFree: true,
      toolAuthoringEnabled: true,
    });
    expect(Object.keys(toolset)).not.toContain(PROPOSE_TOOL_NAME);
  });

  // REGRESSION-4: managed-runtime coordinator mode includes the authoring
  // tool only when toolAuthoringEnabled=true (Decision D5, epic #807: the
  // coordinator allowlist explicitly allows propose_composio_tool as a
  // config-write action). Catches both a silent-strip regression (D5 being
  // reverted) and a leak regression (the tool appearing without the flag).
  it("managed_runtime mode includes the authoring tool only when toolAuthoringEnabled=true (Decision D5)", () => {
    const withFlag = getRuntimeModeToolPolicy("managed_runtime", undefined, {
      toolAuthoringEnabled: true,
    });
    expect(Object.keys(withFlag)).toContain(PROPOSE_TOOL_NAME);

    const withoutFlag = getRuntimeModeToolPolicy("managed_runtime");
    expect(Object.keys(withoutFlag)).not.toContain(PROPOSE_TOOL_NAME);
  });

  // REGRESSION-5: the tool name constant is stable
  // Catches: If PROPOSE_TOOL_NAME is renamed without updating callers
  it("PROPOSE_TOOL_NAME is the expected stable value", () => {
    expect(PROPOSE_TOOL_NAME).toBe("propose_composio_tool");
  });

  // REGRESSION-6: enabling the tool does not drop any existing base tools
  // Catches: If enabling the gate somehow removes standard tools
  it("enabling toolAuthoringEnabled does not remove any existing base tools", () => {
    const withAuthoring = getRuntimeModeToolPolicy("classic", undefined, {
      toolAuthoringEnabled: true,
    });
    for (const name of OPEN_AGENT_TOOL_NAMES) {
      expect(Object.keys(withAuthoring)).toContain(name);
    }
  });
});
