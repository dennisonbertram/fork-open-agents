/**
 * Tests for Phase 6: policy-gated propose_composio_tool tool.
 *
 * BT-006: toolAuthoringEnabled false (default) => the tool is NOT in the toolset
 * BT-007: toolAuthoringEnabled true => the tool is present
 * BT-008: when invoked, the tool calls the propose action from experimental_context
 * BT-009: no privilege escalation — the tool cannot be called when toolAuthoringEnabled is absent/false
 * REGRESSION: default agents (no toolAuthoringEnabled) have no authoring tool
 */

import { describe, expect, it, mock } from "bun:test";

// ── Mock dependencies ─────────────────────────────────────────────────────────
mock.module("ai", () => ({
  tool: <T extends Record<string, unknown>>(def: T) => def,
}));

mock.module("zod", () => {
  const z = {
    object: (shape: unknown) => ({
      _shape: shape,
      parse: (v: unknown) => v,
    }),
    string: () => ({
      min: () => ({ describe: () => ({ _type: "string" }) }),
      describe: () => ({ _type: "string" }),
    }),
    optional: (s: unknown) => ({ _optional: true, _inner: s }),
  };
  return { z, default: z };
});

// ── Import SUT ────────────────────────────────────────────────────────────────
const { proposeComposioToolTool, PROPOSE_TOOL_NAME } = await import("./propose-tool");

describe("propose_composio_tool tool", () => {
  // BT-006: the tool is a real tool object with the right name
  it("exports a tool definition with the correct name", () => {
    expect(PROPOSE_TOOL_NAME).toBe("propose_composio_tool");
    expect(proposeComposioToolTool).toBeDefined();
    expect(typeof proposeComposioToolTool).toBe("object");
  });

  // BT-007: the tool has an execute function
  it("has an execute function", () => {
    expect(typeof (proposeComposioToolTool as Record<string, unknown>)["execute"]).toBe("function");
  });

  // BT-008: the execute fn returns an error when no proposeToolAction is in context
  it("returns an error result when proposeToolAction is absent from context", async () => {
    const executeFn = (proposeComposioToolTool as Record<string, unknown>)["execute"] as (
      input: unknown,
      options: { experimental_context?: unknown }
    ) => Promise<unknown>;

    const result = await executeFn(
      { toolkitSlug: "github", reason: "need github tools" },
      { experimental_context: { sandbox: { state: {} }, model: {} } }, // no proposeToolAction
    ) as Record<string, unknown>;

    expect(result["ok"]).toBe(false);
    expect(typeof result["error"]).toBe("string");
  });

  // BT-009: the execute fn calls proposeToolAction and returns success
  it("calls proposeToolAction from experimental_context and returns ok=true", async () => {
    let capturedSlug: string | null = null;
    let capturedChatId: string | null = null;

    const fakeContext = {
      sandbox: { state: {}, workingDirectory: "/tmp" },
      model: {},
      proposeToolAction: async (input: { toolkitSlug: string; chatId?: string }) => {
        capturedSlug = input.toolkitSlug;
        capturedChatId = input.chatId ?? null;
        return { entryId: "entry-123" };
      },
    };

    const executeFn = (proposeComposioToolTool as Record<string, unknown>)["execute"] as (
      input: unknown,
      options: { experimental_context?: unknown }
    ) => Promise<unknown>;

    const result = await executeFn(
      { toolkitSlug: "github", reason: "need github integration" },
      { experimental_context: fakeContext },
    ) as Record<string, unknown>;

    expect(result["ok"]).toBe(true);
    expect(capturedSlug).toBe("github");
  });
});

describe("propose_composio_tool gating helpers", () => {
  // BT-006 / REGRESSION: getToolsetWithAuthoring returns the tool ONLY when enabled=true
  it("exports a helper that includes the tool when toolAuthoringEnabled=true", async () => {
    const { getProposeTool } = await import("./propose-tool");

    const toolWhenEnabled = getProposeTool({ toolAuthoringEnabled: true });
    const toolWhenDisabled = getProposeTool({ toolAuthoringEnabled: false });
    const toolWhenDefault = getProposeTool({});

    expect(toolWhenEnabled).toBeDefined();
    expect(toolWhenDisabled).toBeUndefined();
    expect(toolWhenDefault).toBeUndefined();
  });
});
