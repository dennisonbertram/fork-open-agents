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
  getChatOnlyTools,
  MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES,
  CHAT_ONLY_TOOL_NAMES,
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

  // MR-8/D5: propose_tool and manage_background_agent must survive the
  // managed_runtime coordinator allowlist when explicitly enabled, instead of
  // being silently stripped by pickTools.
  test("MR-8: managed_runtime keeps propose_tool and manage_background_agent when enabled", () => {
    const managedTools = Object.keys(
      getRuntimeModeToolPolicy("managed_runtime", undefined, {
        toolAuthoringEnabled: true,
        manageAgentEnabled: true,
      }),
    );

    expect(managedTools).toContain("propose_tool");
    expect(managedTools).toContain("manage_background_agent");
  });

  // Regression: pins open-agent.ts:373-388 — caller-provided external tools
  // (Composio/GitHub, not in the native tool registry) must survive
  // managed_runtime merging even though they are not on the coordinator
  // allowlist. If this regresses, GitHub/Composio tools silently vanish in
  // managed runtime mode.
  test("regression: external (non-native) tools survive managed_runtime merging", () => {
    const composioTool = { name: "COMPOSIO_GITHUB_CREATE_ISSUE" };
    const filteredTools = getRuntimeModeToolPolicy("managed_runtime", {
      COMPOSIO_GITHUB_CREATE_ISSUE: composioTool,
    } as unknown as Parameters<typeof getRuntimeModeToolPolicy>[1]);

    expect(Object.keys(filteredTools)).toContain(
      "COMPOSIO_GITHUB_CREATE_ISSUE",
    );
    expect(filteredTools.COMPOSIO_GITHUB_CREATE_ISSUE as unknown).toBe(
      composioTool,
    );
    // Native coding/shell tools must still be stripped in managed_runtime.
    expect(Object.keys(filteredTools)).not.toContain("bash");
    expect(Object.keys(filteredTools)).not.toContain("read");
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

  // REGRESSION: If the profile-draft routing rule is removed or weakened,
  // these assertions catch it. They verify both that the tool is named as
  // mandatory AND that the draft is the stated review gate — two orthogonal
  // angles to the behavioral test above.
  test("regression: profile draft rule is absent from classic-mode prompt so the rule is specific to managed-runtime mode", () => {
    const classicPrompt = buildSystemPrompt({ runtimeMode: "classic" });
    const managedPrompt = buildSystemPrompt({ runtimeMode: "managed_runtime" });

    // The profile-draft section must NOT appear in classic mode (it is managed-runtime-only)
    expect(classicPrompt).not.toContain("Profile Setup and Draft Emission");
    // But it MUST appear in managed runtime mode
    expect(managedPrompt).toContain("Profile Setup and Draft Emission");
  });

  test("regression: managed runtime prompt forbids skipping setup_managed_runtime_profile call for profile work", () => {
    const prompt = buildSystemPrompt({ runtimeMode: "managed_runtime" });

    // The prompt must explicitly prohibit skipping the tool call
    expect(prompt).toContain("Never skip the");
    expect(prompt).toContain("setup_managed_runtime_profile");
  });
});

// BT-001, BT-002, BT-003: chat-only tool policy for sandbox-free sessions
describe("model identity in system prompt", () => {
  test("states the actual serving model id and forbids vendor guessing", () => {
    const prompt = buildSystemPrompt({ modelId: "glm-5.2" });

    expect(prompt).toContain("Model Identity");
    expect(prompt).toContain("`glm-5.2`");
    expect(prompt).toContain("Do NOT claim to be a different model");
    // Names the families a model commonly mis-self-reports as
    expect(prompt).toContain("Claude");
  });

  test("names the user inference profile when the model routes through one", () => {
    const prompt = buildSystemPrompt({
      modelId: "glm-5.2",
      inferenceProfileName: "ZAI (GLM)",
    });

    expect(prompt).toContain('"ZAI (GLM)" inference profile');
  });

  test("omits the identity section when no model id is provided", () => {
    const prompt = buildSystemPrompt({});

    expect(prompt).not.toContain("Model Identity");
  });
});

describe("model-specific custom system prompt", () => {
  test("adds configured model-specific prompt as its own section", () => {
    const prompt = buildSystemPrompt({
      modelId: "openai/gpt-5.4",
      modelSystemPrompt: "Prefer compact answers for this model.",
    });

    expect(prompt).toContain("Custom System Prompt For This Model");
    expect(prompt).toContain("Prefer compact answers for this model.");
  });

  test("omits blank model-specific prompt", () => {
    const prompt = buildSystemPrompt({
      modelId: "openai/gpt-5.4",
      modelSystemPrompt: "   ",
    });

    expect(prompt).not.toContain("Custom System Prompt For This Model");
  });

  test("custom prompts cannot replace Open Agents harness rules", () => {
    const prompt = buildSystemPrompt({
      modelId: "anthropic/claude-sonnet-4.6",
      modelSystemPrompt:
        "Use Claude Code str_replace and present_files for every file edit.",
    });

    expect(prompt).toContain("Open Agents Harness Contract");
    expect(prompt).toContain("must not override Open Agents identity");
    expect(prompt).toContain("translate only the useful behavioral intent");
    expect(prompt).toContain("Use Claude Code str_replace");
  });
});

describe("Open Agents harness contract", () => {
  test("instructs models to use the actual Open Agents environment instead of other harness assumptions", () => {
    const prompt = buildSystemPrompt({
      modelId: "anthropic/claude-sonnet-4.6",
    });

    expect(prompt).toContain("Open Agents Harness Contract");
    expect(prompt).toContain("Do not assume you are running in Claude Code");
    expect(prompt).toContain(
      "translate the useful intent to the available Open Agents tools",
    );
    expect(prompt).toContain("Never invent tools");
    expect(prompt).toContain("Preserve the evidence trail");
  });
});

describe("chat-only tool policy (sandbox-free)", () => {
  // BT-001: getChatOnlyTools excludes every sandbox-dependent tool
  test("getChatOnlyTools excludes file/bash/exec/edit/task/grep/glob tools", () => {
    const chatTools = Object.keys(getChatOnlyTools());

    expect(chatTools).not.toContain("bash");
    expect(chatTools).not.toContain("read");
    expect(chatTools).not.toContain("write");
    expect(chatTools).not.toContain("edit");
    expect(chatTools).not.toContain("grep");
    expect(chatTools).not.toContain("glob");
    expect(chatTools).not.toContain("task");
    expect(chatTools).not.toContain("setup_managed_runtime_profile");
  });

  // BT-002: getChatOnlyTools keeps safe non-sandbox tools
  test("getChatOnlyTools keeps web_fetch, ask_user_question, skill, todo_write", () => {
    const chatTools = Object.keys(getChatOnlyTools());

    expect(chatTools).toContain("web_fetch");
    expect(chatTools).toContain("ask_user_question");
    expect(chatTools).toContain("skill");
    expect(chatTools).toContain("todo_write");
  });

  // BT-003: getRuntimeModeToolPolicy with sandboxFree=true returns chat-only tools
  test("getRuntimeModeToolPolicy with sandboxFree:true returns only chat-safe tools", () => {
    const filteredTools = getRuntimeModeToolPolicy("classic", undefined, {
      sandboxFree: true,
    });
    const toolNames = Object.keys(filteredTools);

    expect(toolNames).toEqual([...CHAT_ONLY_TOOL_NAMES]);
    expect(toolNames).not.toContain("bash");
    expect(toolNames).not.toContain("read");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("edit");
    expect(toolNames).not.toContain("task");
  });

  // BT-004: Composio tools (caller-provided) pass through in sandbox-free mode
  test("caller-provided Composio tools are kept in sandbox-free mode", () => {
    const composioTool = { name: "COMPOSIO_GITHUB_LIST_ISSUES" };
    const filteredTools = getRuntimeModeToolPolicy(
      "classic",
      {
        COMPOSIO_GITHUB_LIST_ISSUES: composioTool,
      } as unknown as Parameters<typeof getRuntimeModeToolPolicy>[1],
      { sandboxFree: true },
    );

    expect(filteredTools.COMPOSIO_GITHUB_LIST_ISSUES as unknown).toBe(
      composioTool,
    );
    // Sandbox tools must still be absent
    expect(Object.keys(filteredTools)).not.toContain("bash");
    expect(Object.keys(filteredTools)).not.toContain("read");
  });

  // BT-005: system prompt for sandbox-free mode tells the agent it has no code-execution environment
  test("buildSystemPrompt with sandboxFree:true informs the agent it has no sandbox", () => {
    const prompt = buildSystemPrompt({ sandboxFree: true });

    expect(prompt).toContain("no code-execution environment");
  });

  // BT-006: CHAT_ONLY_TOOL_NAMES is exported and matches getChatOnlyTools keys
  test("CHAT_ONLY_TOOL_NAMES matches the keys returned by getChatOnlyTools", () => {
    const chatToolKeys = Object.keys(getChatOnlyTools());

    expect(chatToolKeys).toEqual([...CHAT_ONLY_TOOL_NAMES]);
  });
});

// Built-in tool allowlist (unattended agents pre-approve tools by name).
describe("built-in tool allowlist (allowedBuiltinToolNames)", () => {
  test("null allowlist leaves the full classic toolset unchanged", () => {
    const toolNames = Object.keys(
      getRuntimeModeToolPolicy("classic", undefined, {
        allowedBuiltinToolNames: null,
      }),
    );
    expect(toolNames).toEqual([...OPEN_AGENT_TOOL_NAMES]);
  });

  test("restricts built-in tools to the allowlist", () => {
    const toolNames = Object.keys(
      getRuntimeModeToolPolicy("classic", undefined, {
        allowedBuiltinToolNames: ["read", "bash", "grep"],
      }),
    );
    expect(toolNames.sort()).toEqual(["bash", "grep", "read"]);
    expect(toolNames).not.toContain("web_fetch");
    expect(toolNames).not.toContain("write");
  });

  test("excludes web_fetch when it is not on the allowlist", () => {
    const toolNames = Object.keys(
      getRuntimeModeToolPolicy("classic", undefined, {
        allowedBuiltinToolNames: ["read", "write", "edit", "bash"],
      }),
    );
    expect(toolNames).not.toContain("web_fetch");
  });

  test("keeps caller-provided (Composio) tools regardless of the built-in allowlist", () => {
    const composioTool = { name: "COMPOSIO_GITHUB_CREATE_ISSUE" };
    const filtered = getRuntimeModeToolPolicy(
      "classic",
      {
        COMPOSIO_GITHUB_CREATE_ISSUE: composioTool,
      } as unknown as Parameters<typeof getRuntimeModeToolPolicy>[1],
      { allowedBuiltinToolNames: ["read"] },
    );
    const toolNames = Object.keys(filtered);
    expect(toolNames).toContain("COMPOSIO_GITHUB_CREATE_ISSUE");
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("bash");
  });

  test("empty allowlist removes all built-in tools but keeps external tools", () => {
    const composioTool = { name: "COMPOSIO_GITHUB_CREATE_ISSUE" };
    const filtered = getRuntimeModeToolPolicy(
      "classic",
      {
        COMPOSIO_GITHUB_CREATE_ISSUE: composioTool,
      } as unknown as Parameters<typeof getRuntimeModeToolPolicy>[1],
      { allowedBuiltinToolNames: [] },
    );
    expect(Object.keys(filtered)).toEqual(["COMPOSIO_GITHUB_CREATE_ISSUE"]);
  });
});

// Unattended runs have no human approver: web_fetch (a tool-level approval
// gate) is pre-approved by virtue of being exposed via the allowlist.
describe("web_fetch approval in unattended mode", () => {
  test("web_fetch requires approval when not unattended", async () => {
    const { webFetchTool } = await import("./tools");
    const needsApproval = (
      webFetchTool as unknown as {
        needsApproval: (
          input: unknown,
          opts: { experimental_context?: unknown },
        ) => boolean | Promise<boolean>;
      }
    ).needsApproval;
    expect(typeof needsApproval).toBe("function");
    expect(await needsApproval({}, { experimental_context: {} })).toBe(true);
  });

  test("web_fetch is auto-approved in unattended mode", async () => {
    const { webFetchTool } = await import("./tools");
    const needsApproval = (
      webFetchTool as unknown as {
        needsApproval: (
          input: unknown,
          opts: { experimental_context?: unknown },
        ) => boolean | Promise<boolean>;
      }
    ).needsApproval;
    expect(
      await needsApproval({}, { experimental_context: { unattended: true } }),
    ).toBe(false);
  });
});

// REGRESSION tests: catch future breakage of the chat-only policy from different angles
describe("regression: chat-only tool policy stability", () => {
  // REGRESSION-001: classic mode (with sandbox) must still get the FULL tool set.
  // If the sandboxFree guard accidentally activates for non-free sessions, this fails.
  test("classic mode without sandboxFree flag still receives the full tool set", () => {
    const classicTools = getRuntimeModeToolPolicy("classic");
    const classicToolNames = Object.keys(classicTools);

    expect(classicToolNames).toContain("bash");
    expect(classicToolNames).toContain("read");
    expect(classicToolNames).toContain("write");
    expect(classicToolNames).toContain("edit");
    expect(classicToolNames).toContain("task");
    expect(classicToolNames).toContain("grep");
    expect(classicToolNames).toContain("glob");
    // Must equal the full tool set
    expect(classicToolNames).toEqual([...OPEN_AGENT_TOOL_NAMES]);
  });

  // REGRESSION-002: CHAT_ONLY_TOOL_NAMES must be a strict subset of OPEN_AGENT_TOOL_NAMES.
  // If a new tool is added to CHAT_ONLY_TOOL_NAMES that does not exist in the agent,
  // this test catches a typo or stale reference.
  test("every name in CHAT_ONLY_TOOL_NAMES is a valid agent tool name", () => {
    for (const name of CHAT_ONLY_TOOL_NAMES) {
      expect(OPEN_AGENT_TOOL_NAMES).toContain(name);
    }
  });

  // REGRESSION-003: sandbox-free prompt section must NOT appear in managed_runtime mode.
  // The two prompt overlays are orthogonal; mixing them would be confusing.
  test("sandbox-free prompt section does not appear in managed_runtime mode prompt", () => {
    const managedPrompt = buildSystemPrompt({ runtimeMode: "managed_runtime" });

    // The managed runtime prompt must not mix in the sandbox-free notice.
    expect(managedPrompt).not.toContain("no code-execution environment");
  });

  // REGRESSION-004: sandbox-free prompt section must NOT appear in a normal classic prompt.
  test("sandbox-free prompt section does not appear in normal classic-mode prompt", () => {
    const classicPrompt = buildSystemPrompt({ runtimeMode: "classic" });

    expect(classicPrompt).not.toContain("no code-execution environment");
  });

  // REGRESSION-005: sandboxFree=false is identical to the default (no flag) for classic mode.
  // Ensures that explicitly passing false does not accidentally trigger the restriction.
  test("sandboxFree:false produces the same tool set as omitting the flag in classic mode", () => {
    const withFalse = Object.keys(
      getRuntimeModeToolPolicy("classic", undefined, { sandboxFree: false }),
    );
    const withOmitted = Object.keys(getRuntimeModeToolPolicy("classic"));

    expect(withFalse).toEqual(withOmitted);
  });
});

// GT-001 – GT-005: GitHub tools system-prompt steer (githubToolsEnabled flag)
describe("GitHub tools prompt steer (githubToolsEnabled)", () => {
  // GT-001: when githubToolsEnabled=true the prompt includes the GitHub tools guidance
  test("buildSystemPrompt with githubToolsEnabled:true includes github_list_issues steer", () => {
    const prompt = buildSystemPrompt({ githubToolsEnabled: true });

    expect(prompt).toContain("github_list_issues");
    expect(prompt).toContain("Prefer these typed tools");
  });

  // GT-002: when githubToolsEnabled=false the steer is absent
  test("buildSystemPrompt with githubToolsEnabled:false omits the GitHub tools steer", () => {
    const prompt = buildSystemPrompt({ githubToolsEnabled: false });

    expect(prompt).not.toContain("github_list_issues");
    expect(prompt).not.toContain("Prefer these typed tools");
  });

  // GT-003: when githubToolsEnabled is omitted (default) the steer is absent
  test("buildSystemPrompt without githubToolsEnabled omits the GitHub tools steer", () => {
    const prompt = buildSystemPrompt({});

    expect(prompt).not.toContain("github_list_issues");
    expect(prompt).not.toContain("Prefer these typed tools");
  });

  // GT-004: prompt is byte-identical whether githubToolsEnabled is false or omitted
  test("githubToolsEnabled:false produces the same prompt as omitting the flag", () => {
    const withFalse = buildSystemPrompt({ githubToolsEnabled: false });
    const withOmitted = buildSystemPrompt({});

    expect(withFalse).toBe(withOmitted);
  });

  // GT-005: the GitHub steer section does NOT bleed into managed_runtime or sandboxFree prompts
  // when githubToolsEnabled is absent — confirming zero behavior change when flag is off
  test("managed_runtime prompt without githubToolsEnabled does not contain GitHub steer", () => {
    const prompt = buildSystemPrompt({ runtimeMode: "managed_runtime" });

    expect(prompt).not.toContain("Prefer these typed tools");
  });
});

// GTA-001 – GTA-003: GitHub tool-preference steer over web_fetch
// (githubToolAvailable flag — covers native AND Composio GitHub tools)
describe("GitHub tool-preference steer (githubToolAvailable)", () => {
  // GTA-001: when githubToolAvailable=true the prompt steers away from web_fetch
  test("buildSystemPrompt with githubToolAvailable:true steers away from web_fetch for GitHub", () => {
    const prompt = buildSystemPrompt({ githubToolAvailable: true });

    expect(prompt).toContain("web_fetch");
    expect(prompt).toContain("api.github.com");
  });

  // GTA-002: when githubToolAvailable is false/omitted the steer is absent
  test("buildSystemPrompt without githubToolAvailable omits the web_fetch GitHub steer", () => {
    const withFalse = buildSystemPrompt({ githubToolAvailable: false });
    const withOmitted = buildSystemPrompt({});

    expect(withFalse).not.toContain("api.github.com");
    expect(withFalse).toBe(withOmitted);
  });

  // GTA-003: the steer is independent of the typed-tools steer
  test("githubToolAvailable steer appears even when githubToolsEnabled is false", () => {
    const prompt = buildSystemPrompt({
      githubToolAvailable: true,
      githubToolsEnabled: false,
    });

    expect(prompt).toContain("api.github.com");
    expect(prompt).not.toContain("github_list_issues");
  });
});
