import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const SLICE_ONE_TOOL_NAMES = [
  "open_agents_whoami",
  "open_agents_list_sessions",
  "open_agents_get_session",
  "open_agents_get_messages",
  "open_agents_get_diff_summary",
] as const;

const ALLOWED_SCOPES = [
  "sessions:read",
  "sessions:write",
  "agents:read",
  "agents:write",
  "sandbox:exec",
] as const;

const getSessionsWithUnreadByUserId = mock(async () => []);
const getSessionById = mock(async () => undefined);
const getChatById = mock(async () => undefined);
const getChatsBySessionId = mock(async () => []);
const getChatSummariesBySessionId = mock(async () => []);
const getChatMessages = mock(async () => []);
const getSessionMetadataById = mock(async () => undefined);
const getSessionDiffById = mock(async () => undefined);
const getRecentChatMessages = mock(async () => []);
const countChatMessages = mock(async () => 0);
const countSessionsByUserId = mock(async () => 0);

// A module mock must export EVERY symbol the module under test imports from
// it, or the import fails at load time with "Export named 'x' not found".
mock.module("@/lib/db/sessions", () => ({
  getSessionsWithUnreadByUserId,
  getSessionById,
  getChatById,
  getChatsBySessionId,
  getChatSummariesBySessionId,
  getChatMessages,
  getSessionMetadataById,
  getSessionDiffById,
  getRecentChatMessages,
  countChatMessages,
  countSessionsByUserId,
}));

const modPromise = import("./registry");

function makeCtx(overrides?: {
  userId?: string;
  scopes?: string[];
  requestId?: string;
}) {
  return {
    userId: overrides?.userId ?? "user-1",
    scopes: (overrides?.scopes ?? ["sessions:read"]) as never[],
    requestId: overrides?.requestId ?? "req-1",
  };
}

describe("mcpToolRegistry contract", () => {
  beforeEach(() => {
    getSessionsWithUnreadByUserId.mockClear();
    getSessionsWithUnreadByUserId.mockImplementation(async () => []);
    getSessionById.mockClear();
    getSessionById.mockImplementation(async () => undefined);
    getChatById.mockClear();
    getChatsBySessionId.mockClear();
    getChatSummariesBySessionId.mockClear();
    getChatMessages.mockClear();
  });

  test("is non-empty", async () => {
    const { mcpToolRegistry } = await modPromise;
    expect(mcpToolRegistry.length).toBeGreaterThan(0);
  });

  test("every tool declares a non-empty name, description, scope, and input schema", async () => {
    const { mcpToolRegistry } = await modPromise;

    for (const def of mcpToolRegistry) {
      expect(typeof def.name).toBe("string");
      expect(def.name.trim().length).toBeGreaterThan(0);

      expect(typeof def.description).toBe("string");
      expect(def.description.trim().length).toBeGreaterThan(0);

      expect(typeof def.scope).toBe("string");
      expect(def.scope.trim().length).toBeGreaterThan(0);

      // A real Zod schema object, not a raw shape: must support parsing.
      expect(typeof def.inputSchema).toBe("object");
      expect(def.inputSchema).not.toBeNull();
      expect(typeof def.inputSchema.safeParse).toBe("function");
      expect(typeof def.inputSchema.parse).toBe("function");

      expect(typeof def.handler).toBe("function");
    }
  });

  test("every declared scope is one of the five allowed MCP scopes", async () => {
    const { mcpToolRegistry } = await modPromise;

    for (const def of mcpToolRegistry) {
      expect(ALLOWED_SCOPES).toContain(def.scope);
    }
  });

  test("includes all five slice-1 read tool names", async () => {
    const { mcpToolRegistry } = await modPromise;
    const names = mcpToolRegistry.map((def) => def.name);

    for (const expectedName of SLICE_ONE_TOOL_NAMES) {
      expect(names).toContain(expectedName);
    }
  });

  test("tool names are unique", async () => {
    const { mcpToolRegistry } = await modPromise;
    const names = mcpToolRegistry.map((def) => def.name);
    const uniqueNames = new Set(names);

    expect(uniqueNames.size).toBe(names.length);
  });
});

describe("getMcpTool", () => {
  test("finds a registered tool by exact name", async () => {
    const { getMcpTool } = await modPromise;
    const def = getMcpTool("open_agents_whoami");

    expect(def).toBeDefined();
    expect(def?.name).toBe("open_agents_whoami");
  });

  test("returns undefined for an unknown name and does not case-fold", async () => {
    const { getMcpTool } = await modPromise;

    expect(getMcpTool("does_not_exist")).toBeUndefined();
    expect(getMcpTool("OPEN_AGENTS_WHOAMI")).toBeUndefined();
  });
});

describe("listMcpTools", () => {
  test("returns only tools whose scope is in the given scopes, in registry order", async () => {
    const { listMcpTools, mcpToolRegistry } = await modPromise;

    const result = listMcpTools(["sessions:read"] as never[]);
    const expectedNames = mcpToolRegistry
      .filter((def) => def.scope === "sessions:read")
      .map((def) => def.name);

    expect(result.map((def) => def.name)).toEqual(expectedNames);
  });

  test("returns an empty array when given no scopes", async () => {
    const { listMcpTools } = await modPromise;

    expect(listMcpTools([])).toEqual([]);
  });
});

describe("runMcpTool dispatch order", () => {
  test("unknown tool name throws McpToolError with errorKind not_found", async () => {
    const { runMcpTool } = await modPromise;
    const { McpToolError } = await import("./context");

    const ctx = makeCtx();

    await expect(
      runMcpTool("totally_unknown_tool", ctx, {}),
    ).rejects.toBeInstanceOf(McpToolError);

    try {
      await runMcpTool("totally_unknown_tool", ctx, {});
      throw new Error("expected runMcpTool to reject");
    } catch (error) {
      expect((error as InstanceType<typeof McpToolError>).errorKind).toBe(
        "not_found",
      );
    }
  });

  test("missing scope beats malformed input: forbidden_scope wins and no I/O happens", async () => {
    const { runMcpTool } = await modPromise;
    const { McpToolError } = await import("./context");

    // list_sessions requires "sessions:read"; this ctx has none, and the
    // input is also malformed (limit must be a number).
    const ctx = makeCtx({ scopes: [] });

    try {
      await runMcpTool("open_agents_list_sessions", ctx, {
        limit: "not-a-number",
      });
      throw new Error("expected runMcpTool to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(McpToolError);
      expect((error as InstanceType<typeof McpToolError>).errorKind).toBe(
        "forbidden_scope",
      );
    }

    expect(getSessionsWithUnreadByUserId).not.toHaveBeenCalled();
  });

  test("malformed input on a granted scope throws invalid_request", async () => {
    const { runMcpTool } = await modPromise;
    const { McpToolError } = await import("./context");

    const ctx = makeCtx({ scopes: ["sessions:read"] });

    try {
      await runMcpTool("open_agents_list_sessions", ctx, {
        limit: "not-a-number",
      });
      throw new Error("expected runMcpTool to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(McpToolError);
      expect((error as InstanceType<typeof McpToolError>).errorKind).toBe(
        "invalid_request",
      );
    }

    expect(getSessionsWithUnreadByUserId).not.toHaveBeenCalled();
  });

  test("valid call on a granted scope resolves with the handler's result", async () => {
    const { runMcpTool } = await modPromise;
    const ctx = makeCtx({ userId: "user-42", scopes: ["sessions:read"] });

    const result = await runMcpTool("open_agents_whoami", ctx, {});

    expect(result).toEqual({
      userId: "user-42",
      scopes: ["sessions:read"],
      requestId: ctx.requestId,
    });
  });

  test("an unexpected non-McpToolError thrown by a handler is wrapped as internal_error", async () => {
    const { runMcpTool } = await modPromise;
    const { McpToolError } = await import("./context");

    getSessionsWithUnreadByUserId.mockImplementation(async () => {
      throw new Error("connection string leak: postgres://user:pass@host/db");
    });

    const ctx = makeCtx({ scopes: ["sessions:read"] });

    try {
      await runMcpTool("open_agents_list_sessions", ctx, {});
      throw new Error("expected runMcpTool to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(McpToolError);
      const mcpError = error as InstanceType<typeof McpToolError>;
      expect(mcpError.errorKind).toBe("internal_error");
      expect(mcpError.message).not.toContain("postgres://");
      expect(mcpError.details).toBeUndefined();
    }
  });
});
