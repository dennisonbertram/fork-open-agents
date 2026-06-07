import { describe, expect, mock, test } from "bun:test";

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
      if (part.toolName) {
        return part.toolName;
      }

      if (typeof part.type === "string" && part.type.startsWith("tool-")) {
        return part.type.slice(5);
      }

      return "";
    },
    isToolUIPart: (part: unknown) => {
      if (!part || typeof part !== "object") {
        return false;
      }

      const candidate = part as { type?: unknown };
      return (
        typeof candidate.type === "string" && candidate.type.startsWith("tool-")
      );
    },
    stepCountIs: (count: number) => ({ count }),
    ToolLoopAgent: MockToolLoopAgent,
    tool: <T extends Record<string, unknown>>(definition: T) => definition,
    wrapLanguageModel: ({ model }: { model: unknown }) => model,
  };
});

const {
  getOpenAgentToolsForRuntimeMode,
  getRuntimeModeToolPolicy,
  MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES,
  OPEN_AGENT_TOOL_NAMES,
} = await import("./open-agent");
const { buildSystemPrompt } = await import("./system-prompt");

describe("openAgent runtime tool policy", () => {
  test("keeps the full direct toolset in classic mode", () => {
    const classicTools = Object.keys(
      getOpenAgentToolsForRuntimeMode("classic"),
    );

    expect(classicTools).toEqual([...OPEN_AGENT_TOOL_NAMES]);
  });

  test("merges caller-provided tools with the direct toolset in classic mode", () => {
    const composioTool = { name: "COMPOSIO_GITHUB_CREATE_ISSUE" };
    const classicTools = getRuntimeModeToolPolicy("classic", {
      COMPOSIO_GITHUB_CREATE_ISSUE: composioTool,
    } as unknown as Parameters<typeof getRuntimeModeToolPolicy>[1]);

    expect(Object.keys(classicTools)).toEqual([
      ...OPEN_AGENT_TOOL_NAMES,
      "COMPOSIO_GITHUB_CREATE_ISSUE",
    ]);
    expect(classicTools.COMPOSIO_GITHUB_CREATE_ISSUE as unknown).toBe(
      composioTool,
    );
  });

  test("removes direct coding and shell tools in managed runtime mode", () => {
    const managedTools = Object.keys(
      getOpenAgentToolsForRuntimeMode("managed_runtime"),
    );

    expect(managedTools).toEqual([...MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES]);
    expect(managedTools).not.toContain("read");
    expect(managedTools).not.toContain("write");
    expect(managedTools).not.toContain("edit");
    expect(managedTools).not.toContain("grep");
    expect(managedTools).not.toContain("glob");
    expect(managedTools).not.toContain("bash");
    expect(managedTools).toContain("task");
  });

  test("filters caller-provided tools through the managed runtime coordinator policy", () => {
    const requestedTools = {
      bash: { name: "bash" },
      read: { name: "read" },
      task: { name: "task" },
      web_fetch: { name: "web_fetch" },
    } as unknown as Parameters<typeof getRuntimeModeToolPolicy>[1];
    const filteredTools = getRuntimeModeToolPolicy(
      "managed_runtime",
      requestedTools,
    );

    expect(Object.keys(filteredTools)).toEqual([
      ...MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES,
    ]);
  });

  test("injects managed runtime coordinator instructions into the system prompt", () => {
    const prompt = buildSystemPrompt({ runtimeMode: "managed_runtime" });

    expect(prompt).toContain("Managed Runtime Coordinator Mode");
    expect(prompt).toContain("Do not directly edit files");
    expect(prompt).toContain("delegate implementation");
  });

  test("instructs the coordinator to call setup_managed_runtime_profile to emit a draft when the user asks to set up or build a managed runtime profile", () => {
    const prompt = buildSystemPrompt({ runtimeMode: "managed_runtime" });

    // The prompt must name the tool so the model knows it exists and must call it
    expect(prompt).toContain("setup_managed_runtime_profile");
    // The prompt must make clear the coordinator should emit a draft for user review
    expect(prompt).toContain("draft");
  });
});
