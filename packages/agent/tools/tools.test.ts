import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolNeedsApprovalFunction } from "./utils";

const sandboxRegistry = new Map<string, Record<string, unknown>>();
let mockToolLoopAgentStream:
  | ((
      args: Record<string, unknown>,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>)
  | undefined;

mock.module("ai", () => {
  class MockToolLoopAgent {
    constructor(_config: unknown) {}

    stream(args: Record<string, unknown>) {
      if (mockToolLoopAgentStream) {
        return mockToolLoopAgentStream(args);
      }

      throw new Error(
        "MockToolLoopAgent.stream should not be called in this test",
      );
    }
  }

  const gateway = (modelId: string) => ({ modelId });

  return {
    tool: <T extends Record<string, unknown>>(definition: T) => definition,
    gateway,
    // packages/agent/models.ts's own gateway() (used by the roster's
    // applyRosterOverrides, transitively loaded from ./task) builds on these
    // — the mock above only stood in for the AI SDK's default gateway.
    createGateway: (_settings?: Record<string, unknown>) => gateway,
    wrapLanguageModel: ({ model }: { model: unknown }) => model,
    defaultSettingsMiddleware: (_settings: unknown) => ({
      kind: "default-settings-middleware",
    }),
    stepCountIs: (count: number) => ({ count }),
    ToolLoopAgent: MockToolLoopAgent,
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
        typeof candidate.type === "string" &&
        (candidate.type.startsWith("tool-") ||
          candidate.type === "dynamic-tool")
      );
    },
  };
});

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async (state: { sandboxId?: string }) => {
    if (!state.sandboxId) {
      throw new Error("Missing sandboxId in test sandbox state.");
    }

    const sandbox = sandboxRegistry.get(state.sandboxId);
    if (!sandbox) {
      throw new Error(`Unknown test sandbox: ${state.sandboxId}`);
    }

    return sandbox;
  },
  tryConnectVercelSandboxDirect: async () => null,
}));

const { askUserQuestionTool } = await import("./ask-user-question");
const { bashTool, commandNeedsApproval } = await import("./bash");
const { MAX_BODY_LENGTH, isAllowedWebUrl, webFetchTool } =
  await import("./fetch");
const { globTool } = await import("./glob");
const { grepTool } = await import("./grep");
const { setupManagedRuntimeProfileTool } =
  await import("./managed-runtime-profile-builder");
const { readFileTool } = await import("./read");
const { skillTool } = await import("./skill");
const { taskTool } = await import("./task");
const { delegatedWorkspacePolicySchema } =
  await import("../delegated-workspace");
const { defaultSharedWriterLeaseManager } =
  await import("../shared-writer-lease");
const { todoWriteTool } = await import("./todo");
const { editFileTool, writeFileTool } = await import("./write");
const { buildSystemPrompt } = await import("../system-prompt");

function createContext(sandbox: Record<string, unknown>) {
  const sandboxId = `sandbox-${sandboxRegistry.size + 1}`;
  sandboxRegistry.set(sandboxId, sandbox);

  return {
    sandbox: {
      state: { type: "vercel" as const, sandboxId },
      workingDirectory:
        typeof sandbox.workingDirectory === "string"
          ? sandbox.workingDirectory
          : "/repo",
      isolatedWorkspaceProvisioner:
        typeof sandbox.isolatedWorkspaceProvisioner === "function"
          ? sandbox.isolatedWorkspaceProvisioner
          : undefined,
    },
    approval: {},
    model: "test-model",
  };
}

function executionOptions(experimental_context?: unknown) {
  return {
    toolCallId: "tool-call-1",
    messages: [],
    experimental_context,
  };
}

async function getNeedsApprovalResult<TArgs>(
  needsApproval: boolean | ToolNeedsApprovalFunction<TArgs> | undefined,
  args: TArgs,
  experimental_context: unknown,
) {
  if (typeof needsApproval === "function") {
    return await Promise.resolve(
      needsApproval(args, executionOptions(experimental_context)),
    );
  }
  return needsApproval ?? false;
}

async function git(cwd: string, args: string[]) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(await new Response(proc.stderr).text());
  }
}

async function createGitWorkspace() {
  const workspace = await mkdtemp(path.join(tmpdir(), "task-workspace-"));
  await git(workspace, ["init"]);
  await git(workspace, ["config", "user.email", "agent@example.com"]);
  await git(workspace, ["config", "user.name", "Agent"]);
  await writeFile(path.join(workspace, "README.md"), "baseline\n");
  await git(workspace, ["add", "."]);
  await git(workspace, ["commit", "-m", "baseline"]);
  return workspace;
}

/**
 * A delegated-worker stream shaped the way the AI SDK actually behaves when the
 * provider fails: `stream()` resolves, `fullStream` opens with the synthetic
 * `start` part *before* the request is made, the failure arrives as an `error`
 * part, and the derived `response` promise rejects with the SDK's generic
 * no-output message.
 *
 * A mock that throws synchronously from `stream()` exercises a path production
 * never takes, which is how #1140 and #1141 stayed green in CI while every
 * delegated worker in production failed without attribution.
 *
 * `response` is a getter so the rejected promise is only created when the code
 * under test actually awaits it — an eagerly-created rejection would surface as
 * an unhandled rejection in the cases that throw before reaching it.
 */
function providerFailureStream({
  error,
  partsBeforeFailure = [],
}: {
  error: Error;
  partsBeforeFailure?: Record<string, unknown>[];
}) {
  return () => ({
    fullStream: (async function* () {
      yield { type: "start" };
      for (const part of partsBeforeFailure) {
        yield part;
      }
      yield { type: "error", error };
    })(),
    get response() {
      return Promise.reject(
        new Error("No output generated. Check the stream for errors."),
      );
    },
    usage: Promise.resolve({}),
  });
}

function createFakeIsolatedWorkspaceProvisioner(childId = "child-sandbox") {
  return mock(async (input: { parentWorkspaceId: string }) => ({
    sandbox: {
      state: { type: "vercel" as const, sandboxId: childId },
      workingDirectory: `/workspaces/${childId}`,
    },
    provenance: {
      parentWorkspaceId: input.parentWorkspaceId,
      childWorkspaceId: childId,
      backendKind: "fake",
      createdAt: Date.now(),
    },
  }));
}

async function createFsSandbox() {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), "agent-tools-"));

  const sandbox = {
    workingDirectory,
    stat: (filePath: string) => stat(filePath),
    readFile: (filePath: string, encoding: BufferEncoding) =>
      readFile(filePath, { encoding }),
    writeFile: (filePath: string, content: string, encoding: BufferEncoding) =>
      writeFile(filePath, content, { encoding }),
    mkdir: (dirPath: string, options: { recursive: boolean }) =>
      mkdir(dirPath, options),
  };

  return { sandbox, workingDirectory };
}

describe("tools execute behavior", () => {
  test("readFileTool returns numbered lines for offset/limit", async () => {
    const { sandbox, workingDirectory } = await createFsSandbox();
    const filePath = path.join(workingDirectory, "notes.txt");
    await writeFile(filePath, "line-1\nline-2\nline-3", "utf-8");

    const result = await readFileTool().execute?.(
      { filePath, offset: 2, limit: 2 },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toEqual({
      success: true,
      path: "notes.txt",
      totalLines: 3,
      startLine: 2,
      endLine: 3,
      content: "2: line-2\n3: line-3",
    });
  });

  test("readFileTool rejects reading directories", async () => {
    const { sandbox, workingDirectory } = await createFsSandbox();

    const result = await readFileTool().execute?.(
      { filePath: workingDirectory },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toEqual({
      success: false,
      error: "Cannot read a directory. Use glob or ls command instead.",
    });
  });

  test("readFileTool requires approval for dotenv files", async () => {
    const baseContext = {
      sandbox: { workingDirectory: "/repo" },
      model: "test-model",
    };

    const dotenvApproval = await getNeedsApprovalResult(
      readFileTool().needsApproval,
      { filePath: ".env.local" },
      baseContext,
    );
    expect(dotenvApproval).toBe(true);

    const nestedDotenvApproval = await getNeedsApprovalResult(
      readFileTool().needsApproval,
      { filePath: "apps/web/.env.production" },
      baseContext,
    );
    expect(nestedDotenvApproval).toBe(true);

    // A template skips approval only when git confirms it is committed and
    // unmodified. This fixture's sandbox has no `exec`, so the check cannot
    // run and the file stays gated — fail closed is the point. The confirmed
    // and unconfirmed cases are covered in path-security.test.ts.
    const unverifiableTemplateApproval = await getNeedsApprovalResult(
      readFileTool().needsApproval,
      { filePath: "apps/web/.env.example" },
      baseContext,
    );
    expect(unverifiableTemplateApproval).toBe(true);

    const regularFileApproval = await getNeedsApprovalResult(
      readFileTool().needsApproval,
      { filePath: "README.md" },
      baseContext,
    );
    expect(regularFileApproval).toBe(false);
  });

  test("writeFileTool creates parent directories and writes content", async () => {
    const { sandbox, workingDirectory } = await createFsSandbox();
    const relativePath = "nested/output.txt";

    const result = await writeFileTool().execute?.(
      { filePath: relativePath, content: "hello" },
      executionOptions(createContext(sandbox)),
    );

    const expectedPath = path.join(workingDirectory, relativePath);
    const written = await readFile(expectedPath, "utf-8");

    expect(written).toBe("hello");
    expect(result).toEqual({
      success: true,
      path: relativePath,
      bytesWritten: 5,
    });
  });

  test("editFileTool rejects ambiguous replacement unless replaceAll is true", async () => {
    const { sandbox, workingDirectory } = await createFsSandbox();
    const filePath = path.join(workingDirectory, "src.txt");
    await writeFile(filePath, "alpha\nalpha\nomega", "utf-8");

    const result = await editFileTool().execute?.(
      { filePath, oldString: "alpha", newString: "beta" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toEqual({
      success: false,
      error:
        "oldString found 2 times. Use replaceAll=true or provide more context to make it unique.",
    });
  });

  test("editFileTool replaces all matches and reports first start line", async () => {
    const { sandbox, workingDirectory } = await createFsSandbox();
    const filePath = path.join(workingDirectory, "src.txt");
    await writeFile(filePath, "alpha\nalpha\nomega", "utf-8");

    const result = await editFileTool().execute?.(
      { filePath, oldString: "alpha", newString: "beta", replaceAll: true },
      executionOptions(createContext(sandbox)),
    );

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("beta\nbeta\nomega");
    expect(result).toEqual({
      success: true,
      path: "src.txt",
      replacements: 2,
      startLine: 1,
    });
  });

  test("grepTool parses grep output and truncates long content", async () => {
    let executedCommand = "";
    const sandbox = {
      workingDirectory: "/repo",
      exec: async (command: string) => {
        executedCommand = command;
        return {
          success: true,
          exitCode: 0,
          stdout:
            "/repo/src/a.ts:12:match-a\n/repo/src/b.ts:7:" + "x".repeat(300),
          stderr: "",
        };
      },
    };

    const result = await grepTool().execute?.(
      {
        pattern: "match",
        path: "src",
        glob: "*.ts",
        caseSensitive: false,
      },
      executionOptions(createContext(sandbox)),
    );

    expect(executedCommand).toContain("--include='*.ts'");
    expect(executedCommand).toContain(" -i ");
    expect(result).toMatchObject({
      success: true,
      pattern: "match",
      matchCount: 2,
      filesWithMatches: 2,
    });

    const firstMatch =
      result && typeof result === "object" && "matches" in result
        ? (result.matches as Array<{ file: string; content: string }>)[0]
        : undefined;
    const secondMatch =
      result && typeof result === "object" && "matches" in result
        ? (result.matches as Array<{ file: string; content: string }>)[1]
        : undefined;

    expect(firstMatch?.file).toBe("src/a.ts");
    expect(secondMatch?.content.length).toBe(200);
  });

  test("globTool parses find output into sorted file metadata", async () => {
    let executedCommand = "";
    const sandbox = {
      workingDirectory: "/repo",
      exec: async (command: string) => {
        executedCommand = command;
        return {
          success: true,
          exitCode: 0,
          stdout:
            "1700000000\t12\t/repo/src/a.ts\n1690000000\t20\t/repo/src/b.ts",
          stderr: "",
        };
      },
    };

    const result = await globTool().execute?.(
      { pattern: "src/**/*.ts", path: ".", limit: 2 },
      executionOptions(createContext(sandbox)),
    );

    expect(executedCommand).toContain("head -n 2");
    expect(executedCommand).toContain("-name '*.ts'");
    expect(result).toEqual({
      success: true,
      pattern: "src/**/*.ts",
      baseDir: "src",
      count: 2,
      files: [
        {
          path: "src/a.ts",
          size: 12,
          modifiedAt: "2023-11-14T22:13:20.000Z",
        },
        {
          path: "src/b.ts",
          size: 20,
          modifiedAt: "2023-07-22T04:26:40.000Z",
        },
      ],
    });
  });

  test("bashTool handles detached and non-detached execution", async () => {
    const noDetachSandbox = {
      workingDirectory: "/repo",
      exec: async () => ({
        success: true,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        truncated: true,
      }),
    };

    const detachedUnsupported = await bashTool().execute?.(
      { command: "npm run dev", detached: true },
      executionOptions(createContext(noDetachSandbox)),
    );

    expect(detachedUnsupported).toEqual({
      success: false,
      exitCode: null,
      stdout: "",
      stderr:
        "Detached mode is not supported in this sandbox environment. Only cloud sandboxes support background processes.",
    });

    const detachedSandbox = {
      ...noDetachSandbox,
      execDetached: async () => ({ commandId: "cmd-1" }),
    };

    const detachedResult = await bashTool().execute?.(
      { command: "npm run dev", detached: true },
      executionOptions(createContext(detachedSandbox)),
    );

    expect(detachedResult).toEqual({
      success: true,
      exitCode: null,
      stdout:
        "Process started in background (command ID: cmd-1). The server is now running.",
      stderr: "",
    });

    const normalResult = await bashTool().execute?.(
      { command: "ls" },
      executionOptions(createContext(noDetachSandbox)),
    );

    expect(normalResult).toEqual({
      success: true,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      truncated: true,
    });
  });

  test("commandNeedsApproval flags curl, rm -rf, and dotenv commands", () => {
    // commandNeedsApproval is bashPolicy-only (backward-compat export).
    // It does NOT include gitPushPolicy — that is intentional.
    // For full git-force-push gating, use bashTool().needsApproval or
    // classifyToolApproval("bash", { command }) instead.
    expect(commandNeedsApproval("ls -la")).toBe(false);
    expect(commandNeedsApproval("git status --short")).toBe(false);
    expect(commandNeedsApproval("npm install")).toBe(false);
    expect(commandNeedsApproval("bun install")).toBe(false);
    expect(commandNeedsApproval("custom-command --help")).toBe(false);
    // git reset --hard is bashPolicy-only: NOT gated by commandNeedsApproval.
    // Use bashTool().needsApproval for full gitPushPolicy enforcement.
    expect(commandNeedsApproval("git reset --hard HEAD~1")).toBe(false);
    expect(commandNeedsApproval("curl -s https://example.com")).toBe(true);
    expect(commandNeedsApproval("bash -c 'curl https://example.com'")).toBe(
      true,
    );
    expect(commandNeedsApproval("rm -fr tmp")).toBe(true);
    expect(commandNeedsApproval("rm -r -f tmp")).toBe(true);
    expect(commandNeedsApproval("find . -delete")).toBe(true);
    expect(commandNeedsApproval("rm -rf tmp")).toBe(true);
    expect(commandNeedsApproval("cat .env.local")).toBe(true);
    expect(commandNeedsApproval("cat .e''nv.local")).toBe(true);
    expect(commandNeedsApproval("cat .e$(printf nv).local")).toBe(true);
    expect(commandNeedsApproval("grep API_KEY apps/web/.env.example")).toBe(
      true,
    );
  });

  test("bashTool needsApproval blocks dangerous and dotenv commands by default", async () => {
    const baseContext = {
      sandbox: { workingDirectory: "/repo" },
      model: "test-model",
    };

    const safeCommand = await getNeedsApprovalResult(
      bashTool().needsApproval,
      { command: "ls -la" },
      {
        ...baseContext,
      },
    );
    expect(safeCommand).toBe(false);

    const dangerousCommand = await getNeedsApprovalResult(
      bashTool().needsApproval,
      { command: "rm -rf tmp" },
      {
        ...baseContext,
      },
    );
    expect(dangerousCommand).toBe(true);

    const dotenvCommand = await getNeedsApprovalResult(
      bashTool().needsApproval,
      { command: "cat .env.local" },
      {
        ...baseContext,
      },
    );
    expect(dotenvCommand).toBe(true);

    const allowedBuildCommand = await getNeedsApprovalResult(
      bashTool().needsApproval,
      { command: "bun run ci" },
      {
        ...baseContext,
      },
    );
    expect(allowedBuildCommand).toBe(false);
  });

  // FIX-1: bashTool.needsApproval must enforce gitPushPolicy at runtime.
  // Destructive git ops via bash REQUIRE approval (gitPushPolicy wired into
  // the full classifyToolApproval call, not just bashPolicy-only).
  test("bashTool needsApproval gates destructive git operations via gitPushPolicy (FIX-1)", async () => {
    const baseContext = {
      sandbox: { workingDirectory: "/repo" },
      model: "test-model",
    };

    // git push --force must require approval
    const forcePush = await getNeedsApprovalResult(
      bashTool().needsApproval,
      { command: "git push --force origin main" },
      baseContext,
    );
    expect(forcePush).toBe(true);

    // git reset --hard must require approval
    const resetHard = await getNeedsApprovalResult(
      bashTool().needsApproval,
      { command: "git reset --hard HEAD~1" },
      baseContext,
    );
    expect(resetHard).toBe(true);

    // git clean -fd must require approval
    const cleanFd = await getNeedsApprovalResult(
      bashTool().needsApproval,
      { command: "git clean -fd" },
      baseContext,
    );
    expect(cleanFd).toBe(true);

    // Ordinary git push must NOT require approval (safe command)
    const ordinaryPush = await getNeedsApprovalResult(
      bashTool().needsApproval,
      { command: "git push origin main" },
      baseContext,
    );
    expect(ordinaryPush).toBe(false);

    // Safe commands still pass through without approval
    const safeGitStatus = await getNeedsApprovalResult(
      bashTool().needsApproval,
      { command: "git status --short" },
      baseContext,
    );
    expect(safeGitStatus).toBe(false);
  });

  // #1272: an unattended run (background agent / agent-loop step) has no human
  // to answer an approval prompt. Split on blast radius, not tool identity:
  //   - local bash effects (bashPolicy: rm -rf on scratch paths, .env) stay
  //     inside the ephemeral per-session sandbox -> auto-approve to avoid
  //     wedging the run on a never-approved tool call.
  //   - the git-push family (gitPushPolicy: force-push / reset --hard /
  //     clean -fd) mutates state that outlives the sandbox -> deny.
  describe("bashTool unattended approval policy (#1272)", () => {
    const attendedContext = {
      sandbox: { workingDirectory: "/repo" },
      model: "test-model",
    };
    const unattendedContext = {
      ...attendedContext,
      unattended: true,
    };

    test("unattended run does NOT require approval for a policy-gated local bash command", async () => {
      // A dangerous rm/find command and a sensitive-file command are both gated
      // by bashPolicy but their effect is local to the sandbox.
      for (const command of ["rm -rf tmp", "cat .env.local"]) {
        const result = await getNeedsApprovalResult(
          bashTool().needsApproval,
          { command },
          unattendedContext,
        );
        expect(result).toBe(false);
      }
    });

    test("unattended run DOES refuse a git-push-family command (effect leaves the sandbox)", async () => {
      for (const command of [
        "git push --force origin main",
        "git reset --hard HEAD~1",
        "git clean -fd",
      ]) {
        const result = await getNeedsApprovalResult(
          bashTool().needsApproval,
          { command },
          unattendedContext,
        );
        expect(result).toBe(true);
      }
    });

    test("attended run still requires approval for local and git-push-family bash commands", async () => {
      for (const command of ["rm -rf tmp", "git push --force origin main"]) {
        const result = await getNeedsApprovalResult(
          bashTool().needsApproval,
          { command },
          attendedContext,
        );
        expect(result).toBe(true);
      }
    });
  });

  test("webFetchTool needsApproval gates attended network egress", async () => {
    const baseContext = {
      sandbox: { workingDirectory: "/repo" },
      model: "test-model",
    };

    const getResult = await getNeedsApprovalResult(
      webFetchTool.needsApproval,
      { url: "https://example.com", method: "GET" as const },
      baseContext,
    );
    expect(getResult).toBe(true);

    const postResult = await getNeedsApprovalResult(
      webFetchTool.needsApproval,
      { url: "https://example.com", method: "POST" as const },
      baseContext,
    );
    expect(postResult).toBe(true);

    const unattendedResult = await getNeedsApprovalResult(
      webFetchTool.needsApproval,
      { url: "https://example.com", method: "POST" as const },
      {
        ...baseContext,
        unattended: true,
      },
    );
    expect(unattendedResult).toBe(false);
  });

  afterEach(() => {
    sandboxRegistry.clear();
    mockToolLoopAgentStream = undefined;
    defaultSharedWriterLeaseManager.reset();
  });

  test("webFetchTool treats curl exit 23 as a truncated success", async () => {
    let executedCommand = "";
    const responseBody = "x".repeat(MAX_BODY_LENGTH);

    const sandbox = {
      workingDirectory: "/repo",
      exec: async (command: string) => {
        executedCommand = command;

        if (command.startsWith("getent ahosts")) {
          return {
            success: true,
            exitCode: 0,
            stdout: "93.184.216.34\n",
            stderr: "",
            truncated: false,
          };
        }

        return {
          success: false,
          exitCode: 23,
          stdout: `${responseBody}\n200`,
          stderr: "",
          truncated: false,
        };
      },
    };

    const context = createContext(sandbox);

    const result = await webFetchTool.execute?.(
      {
        url: "https://example.com",
        method: "GET",
      },
      executionOptions(context),
    );

    expect(executedCommand).toContain("curl");
    expect(executedCommand).toContain(`head -c ${MAX_BODY_LENGTH}`);
    expect(result).toMatchObject({
      success: true,
      status: 200,
      truncated: true,
    });

    const body =
      result && typeof result === "object" && "body" in result
        ? (result.body as string)
        : "";
    expect(body.length).toBe(MAX_BODY_LENGTH);
  });

  test("webFetchTool requires approval", async () => {
    const needsApproval = await getNeedsApprovalResult(
      webFetchTool.needsApproval,
      { url: "https://example.com", method: "GET" },
      {
        sandbox: { workingDirectory: "/repo" },
        model: "test-model",
      },
    );

    expect(needsApproval).toBe(true);
  });

  test("webFetchTool rejects public hostnames that resolve to private addresses", async () => {
    const sandbox = {
      workingDirectory: "/repo",
      exec: async (command: string) => {
        if (command.startsWith("getent ahosts")) {
          return {
            success: true,
            exitCode: 0,
            stdout: "127.0.0.1\n",
            stderr: "",
            truncated: false,
          };
        }

        throw new Error("curl should not run for private DNS results");
      },
    };

    const result = await webFetchTool.execute?.(
      {
        url: "https://internal.example",
        method: "GET",
      },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toEqual({
      success: false,
      error: "Fetch failed: URL resolves to a private or internal host",
    });
  });

  test("webFetchTool rejects when DNS resolution fails", async () => {
    const sandbox = {
      workingDirectory: "/repo",
      exec: async (command: string) => {
        if (command.startsWith("getent ahosts")) {
          return {
            success: false,
            exitCode: 2,
            stdout: "",
            stderr: "resolution failed",
            truncated: false,
          };
        }

        throw new Error("curl should not run when DNS validation fails");
      },
    };

    const result = await webFetchTool.execute?.(
      {
        url: "https://unresolved.example",
        method: "GET",
      },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toEqual({
      success: false,
      error: "Fetch failed: URL resolves to a private or internal host",
    });
  });

  test("webFetchTool rejects private and internal URL hosts", () => {
    const blockedUrls = [
      "http://localhost",
      "http://127.0.0.1",
      "http://10.0.0.1",
      "http://172.16.0.1",
      "http://192.168.0.1",
      "http://169.254.169.254",
      "http://0.0.0.0",
      "http://[::]",
      "http://[::1]",
      "http://[fc00::1]",
      "http://[fe80::1]",
      "http://[::ffff:127.0.0.1]",
      "http://[::ffff:0a00:0001]",
      "http://[::ffff:c0a8:0001]",
      "http://[::ffff:ac10:0001]",
    ];

    for (const url of blockedUrls) {
      expect(isAllowedWebUrl(url)).toBe(false);
    }
  });

  test("webFetchTool allows public http and https URL hosts", () => {
    const allowedUrls = [
      "https://example.com",
      "http://93.184.216.34",
      "https://[2606:2800:220:1:248:1893:25c8:1946]",
      "https://[::ffff:5db8:d822]",
    ];

    for (const url of allowedUrls) {
      expect(isAllowedWebUrl(url)).toBe(true);
    }
  });

  test("askUserQuestionTool formats structured answers", () => {
    const answerOutput = askUserQuestionTool.toModelOutput?.({
      toolCallId: "tool-call-1",
      input: { questions: [] },
      output: {
        answers: {
          "Which package manager?": "bun",
          "Which checks?": ["typecheck", "test"],
        },
      },
    });

    expect(answerOutput).toEqual({
      type: "text",
      value:
        'User has answered your questions: "Which package manager?"="bun", "Which checks?"="typecheck, test". You can now continue with the user\'s answers in mind.',
    });

    const declinedOutput = askUserQuestionTool.toModelOutput?.({
      toolCallId: "tool-call-1",
      input: { questions: [] },
      output: { declined: true },
    });

    expect(declinedOutput).toEqual({
      type: "text",
      value:
        "User declined to answer questions. You should continue without this information or ask in a different way.",
    });
  });

  test("setupManagedRuntimeProfileTool reports applied profile ids to the model", () => {
    const output = setupManagedRuntimeProfileTool.toModelOutput?.({
      toolCallId: "tool-call-1",
      input: {
        goal: "Prepare managed runtime setup",
        repoSignals: [],
        draft: {
          displayName: "Bun app",
          description: "Install and verify Bun",
          setupCommands: [
            {
              id: "install",
              label: "Install",
              description: "Install dependencies",
              command: "bun install",
            },
          ],
          verificationCommands: [
            {
              id: "verify",
              label: "Verify",
              description: "Verify Bun",
              command: "bun --version",
            },
          ],
          expectedTools: ["bun"],
          optionalTools: [],
          defaultPorts: [3000],
        },
        questionsForUser: [],
      },
      output: {
        decision: "approved",
        savedProfileId: "session-profile-draft-1",
        appliedToSessionId: "session-1",
        notes: "Use this for the workspace.",
      },
    });

    expect(output).toEqual({
      type: "text",
      value:
        "The user approved the managed runtime profile draft. Saved profile id: session-profile-draft-1. Applied to session: session-1. Notes: Use this for the workspace.",
    });
  });

  test("skillTool loads skill content and substitutes arguments", async () => {
    const sandbox = {
      workingDirectory: "/repo",
      readFile: async () =>
        "---\nname: review\ndescription: review code\n---\nRun review with $ARGUMENTS",
    };

    const result = await skillTool.execute?.(
      { skill: "Review", args: "--quick" },
      executionOptions({
        ...createContext(sandbox),
        skills: [
          {
            name: "review",
            description: "Review code changes",
            path: "/repo/.skills/review",
            filename: "SKILL.md",
            options: {},
          },
        ],
      }),
    );

    expect(result).toEqual({
      success: true,
      skillName: "Review",
      skillPath: "/repo/.skills/review",
      content:
        "Skill directory: /repo/.skills/review\n\nRun review with --quick",
    });
  });

  test("skillTool returns helpful errors for missing or disabled skills", async () => {
    const sandbox = {
      workingDirectory: "/repo",
      readFile: async () => "skill-body",
    };

    const missingResult = await skillTool.execute?.(
      { skill: "unknown" },
      executionOptions({ ...createContext(sandbox), skills: [] }),
    );

    expect(missingResult).toEqual({
      success: false,
      error: "Skill 'unknown' not found. Available skills: none",
    });

    const disabledResult = await skillTool.execute?.(
      { skill: "commit" },
      executionOptions({
        ...createContext(sandbox),
        skills: [
          {
            name: "commit",
            description: "Create a commit",
            path: "/repo/.skills/commit",
            filename: "SKILL.md",
            options: { disableModelInvocation: true },
          },
        ],
      }),
    );

    expect(disabledResult).toEqual({
      success: false,
      error:
        "Skill 'commit' cannot be invoked by the model (disable-model-invocation is set)",
    });
  });

  test("taskTool exposes both subagent types without approval gates", async () => {
    const explorerNeedsApproval = await getNeedsApprovalResult(
      taskTool.needsApproval,
      {
        subagentType: "explorer",
        task: "Find usages",
        instructions: "Search for helper usage",
      },
      {
        sandbox: { workingDirectory: "/repo" },
        model: "test-model",
        approval: {},
      },
    );
    expect(explorerNeedsApproval).toBe(false);

    const executorNeedsApproval = await getNeedsApprovalResult(
      taskTool.needsApproval,
      {
        subagentType: "executor",
        task: "Apply changes",
        instructions: "Update files",
      },
      {
        sandbox: { workingDirectory: "/repo" },
        model: "test-model",
        approval: {},
      },
    );
    expect(executorNeedsApproval).toBe(false);
  });

  test("taskTool description lists subagents from the shared registry", () => {
    expect(taskTool.description).toContain(
      "`explorer` - Use for read-only codebase exploration, tracing behavior, and answering questions without changing files",
    );
    expect(taskTool.description).toContain(
      "`executor` - Use for well-scoped implementation work, including edits, scaffolding, refactors, and other file changes",
    );
    expect(taskTool.description).toContain("up to 100 tool steps");
  });

  test("taskTool emits managed runtime attribution for delegated workers", async () => {
    const finalMessages = [
      {
        role: "assistant",
        content: "Worker finished.",
      },
    ];
    const usage = { inputTokens: 7, outputTokens: 3, totalTokens: 10 };
    const workspace = await createGitWorkspace();

    mockToolLoopAgentStream = mock((args: Record<string, unknown>) => {
      expect(args).toMatchObject({
        options: {
          task: "Apply change",
          sandbox: {
            workingDirectory: workspace,
          },
        },
      });
      const options = args.options as { instructions?: unknown };
      expect(options.instructions).toContain("Managed Runtime Worker Context");
      expect(options.instructions).toContain(
        "Active profile: Web app with Bun and browser checks (web-bun-agent-browser)",
      );
      expect(options.instructions).toContain(
        "Prefer `bun install`, `bun run ...`, and `bun --bun run ...`",
      );
      expect(options.instructions).toContain("node unavailable");

      return {
        fullStream: (async function* () {
          yield {
            type: "tool-call",
            toolName: "bash",
            input: { command: "bun test" },
          };
          yield {
            type: "finish-step",
            usage,
          };
        })(),
        response: Promise.resolve({ messages: finalMessages }),
        usage: Promise.resolve(usage),
      };
    });

    const outputs: unknown[] = [];
    const result = taskTool.execute?.(
      {
        subagentType: "executor",
        task: "Apply change",
        instructions: "Update the greeting and run tests.",
      },
      executionOptions({
        sandbox: {
          workingDirectory: workspace,
          environmentDetails:
            "# Managed Runtime\n\n- Optional tool unavailable: Observe Node.js availability.\n- node unavailable",
        },
        model: { modelId: "test-model" },
        runtimeMode: "managed_runtime",
        managedRuntime: {
          profileId: "web-bun-agent-browser",
          profileVersion: "2026-05-23.1",
          profileDisplayName: "Web app with Bun and browser checks",
          profileRunId: "profile-run-1",
          sandboxName: "session_session-1",
        },
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    for await (const output of result) {
      outputs.push(output);
    }

    expect(outputs[0]).toMatchObject({
      runtime: {
        mode: "managed_runtime",
        label: "Managed runtime worker",
        workerType: "executor",
        profileId: "web-bun-agent-browser",
        profileVersion: "2026-05-23.1",
        profileDisplayName: "Web app with Bun and browser checks",
        profileRunId: "profile-run-1",
        sandboxName: "session_session-1",
      },
    });
    expect(outputs.at(-1)).toMatchObject({
      final: finalMessages,
      runtime: {
        mode: "managed_runtime",
        label: "Managed runtime worker",
        workerType: "executor",
      },
      completionPacket: {
        version: 1,
        status: "completed",
        workerType: "executor",
        workspaceMode: "shared",
        summary: "Worker finished.",
        verification: [
          "Worker reached terminal completed state: worker_terminal.",
          "Observed 1 delegated tool calls.",
        ],
      },
      completionPacketValidation: {
        status: "valid",
        reasonCode: "worker_completion_packet_validated",
      },
    });
  });

  test("taskTool defaults old calls to auto delegated workspace policy", async () => {
    const finalMessages = [{ role: "assistant", content: "Done." }];
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

    mockToolLoopAgentStream = mock((args: Record<string, unknown>) => {
      expect(args).toMatchObject({
        options: {
          task: "Inspect files",
          workspacePolicy: {
            requestedPolicy: "auto",
            effectivePolicy: "auto",
            executionMode: "shared",
            label: "shared workspace",
            status: "policy_recorded",
          },
        },
      });

      return {
        fullStream: (async function* () {})(),
        response: Promise.resolve({ messages: finalMessages }),
        usage: Promise.resolve(usage),
      };
    });

    const outputs: unknown[] = [];
    const result = taskTool.execute?.(
      {
        subagentType: "explorer",
        task: "Inspect files",
        instructions: "Find the relevant files.",
      },
      executionOptions(createContext({ workingDirectory: "/repo" })),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    for await (const output of result) {
      outputs.push(output);
    }

    expect(outputs[0]).toMatchObject({
      workspacePolicy: {
        requestedPolicy: "auto",
        effectivePolicy: "auto",
        executionMode: "shared",
      },
    });
    expect(outputs.at(-1)).toMatchObject({
      final: finalMessages,
      workspacePolicy: {
        requestedPolicy: "auto",
        effectivePolicy: "auto",
        executionMode: "shared",
      },
    });
  });

  test("taskTool passes explicit shared and isolated workspace policies to workers", async () => {
    const finalMessages = [{ role: "assistant", content: "Done." }];
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    const observedPolicies: unknown[] = [];
    const workspace = await createGitWorkspace();

    mockToolLoopAgentStream = mock((args: Record<string, unknown>) => {
      const options = args.options as { workspacePolicy?: unknown };
      observedPolicies.push(options.workspacePolicy);

      return {
        fullStream: (async function* () {})(),
        response: Promise.resolve({ messages: finalMessages }),
        usage: Promise.resolve(usage),
      };
    });

    const isolatedWorkspaceProvisioner =
      createFakeIsolatedWorkspaceProvisioner();
    for (const workspacePolicy of ["shared", "isolated"] as const) {
      const result = taskTool.execute?.(
        {
          subagentType: "executor",
          workspacePolicy,
          task: "Apply change",
          instructions: "Update the implementation.",
        },
        executionOptions(
          createContext({
            workingDirectory: workspace,
            isolatedWorkspaceProvisioner,
          }),
        ),
      ) as AsyncIterable<unknown> | undefined;

      if (!result) {
        throw new Error("taskTool execute missing in test");
      }

      for await (const _output of result) {
        // Drain the generator so the worker launch happens.
      }
    }

    expect(observedPolicies).toEqual([
      {
        requestedPolicy: "shared",
        effectivePolicy: "shared",
        executionMode: "shared",
        label: "shared workspace",
        status: "policy_recorded",
      },
      {
        requestedPolicy: "isolated",
        effectivePolicy: "isolated",
        executionMode: "isolated",
        label: "isolated workspace",
        status: "policy_recorded",
      },
    ]);
  });

  test("taskTool acquires and releases a shared writer lease for write-capable shared workers", async () => {
    const finalMessages = [{ role: "assistant", content: "Done." }];
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    const workspace = await createGitWorkspace();

    mockToolLoopAgentStream = mock(() => ({
      fullStream: (async function* () {})(),
      response: Promise.resolve({ messages: finalMessages }),
      usage: Promise.resolve(usage),
    }));

    const outputs: unknown[] = [];
    const result = taskTool.execute?.(
      {
        subagentType: "executor",
        workspacePolicy: "shared",
        task: "Apply change",
        instructions: "Update the implementation.",
      },
      executionOptions({
        ...createContext({ workingDirectory: workspace }),
        sessionId: "session-1",
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    for await (const output of result) {
      outputs.push(output);
    }

    expect(outputs[0]).toMatchObject({
      delegatedWorkerLifecycle: {
        workerId: "tool-call-1",
        workerType: "executor",
        status: "launching",
        reasonCode: "worker_launching",
        workspaceMode: "shared",
      },
      delegatedWorkerLifecycleEvents: [
        {
          workerId: "tool-call-1",
          status: "launching",
          reasonCode: "worker_launching",
        },
      ],
      sharedWriterLease: {
        status: "acquired",
        sessionId: "session-1",
        workspaceId: "sandbox-1",
        workerId: "tool-call-1",
      },
      sharedWriterLeaseEvents: [
        { type: "shared_writer_lock_acquired", workerId: "tool-call-1" },
      ],
      sharedWorkspaceBaseline: {
        status: "captured",
        workerId: "tool-call-1",
        workspaceId: "sandbox-1",
      },
      sharedWorkspaceDrift: {
        status: "clean",
        reasonCode: "no_drift",
      },
    });
    expect(outputs.at(-1)).toMatchObject({
      delegatedWorkerLifecycle: {
        workerId: "tool-call-1",
        status: "completed",
        reasonCode: "worker_terminal",
      },
      delegatedWorkerLifecycleEvents: [
        { status: "launching" },
        { status: "running" },
        { status: "completed" },
      ],
      sharedWriterLeaseRelease: {
        status: "released",
        events: [
          {
            type: "shared_writer_lock_released",
            reasonCode: "worker_terminal",
          },
        ],
      },
      sharedWriterLeaseEvents: [
        { type: "shared_writer_lock_acquired" },
        { type: "shared_writer_lock_released" },
      ],
    });
  });

  test("taskTool rejects a second active shared writer before worker launch", async () => {
    defaultSharedWriterLeaseManager.acquire({
      sessionId: "session-1",
      workspaceId: "sandbox-1",
      workerId: "active-worker",
    });
    mockToolLoopAgentStream = mock(() => {
      throw new Error("worker should not be launched");
    });

    const result = taskTool.execute?.(
      {
        subagentType: "executor",
        workspacePolicy: "shared",
        task: "Apply change",
        instructions: "Update the implementation.",
      },
      executionOptions({
        ...createContext({ workingDirectory: "/repo" }),
        sessionId: "session-1",
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    const outputs: unknown[] = [];
    await expect(async () => {
      for await (const output of result) {
        outputs.push(output);
      }
    }).toThrow("shared_writer_lock_denied");
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      delegatedWorkerLifecycle: {
        workerId: "tool-call-1",
        status: "blocked",
        reasonCode: "shared_writer_lock_denied",
        workspaceMode: "shared",
      },
      delegatedWorkerLifecycleEvents: [
        {
          workerId: "tool-call-1",
          status: "blocked",
          reasonCode: "shared_writer_lock_denied",
        },
      ],
      sharedWriterLease: {
        status: "denied",
        sessionId: "session-1",
        workspaceId: "sandbox-1",
        workerId: "tool-call-1",
      },
    });
    expect(mockToolLoopAgentStream).not.toHaveBeenCalled();
  });

  test("taskTool does not block read-only shared workers or isolated workers on the shared writer lease", async () => {
    defaultSharedWriterLeaseManager.acquire({
      sessionId: "session-1",
      workspaceId: "sandbox-1",
      workerId: "active-worker",
    });
    const finalMessages = [{ role: "assistant", content: "Done." }];
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    const launchedTasks: string[] = [];
    const isolatedWorkspaceProvisioner =
      createFakeIsolatedWorkspaceProvisioner();

    mockToolLoopAgentStream = mock((args: Record<string, unknown>) => {
      const options = args.options as { task?: string };
      if (options.task) {
        launchedTasks.push(options.task);
      }

      return {
        fullStream: (async function* () {})(),
        response: Promise.resolve({ messages: finalMessages }),
        usage: Promise.resolve(usage),
      };
    });

    for (const input of [
      {
        subagentType: "explorer" as const,
        workspacePolicy: "shared" as const,
        task: "Inspect files",
        instructions: "Find relevant files.",
      },
      {
        subagentType: "executor" as const,
        workspacePolicy: "isolated" as const,
        task: "Apply isolated change",
        instructions: "Update the implementation.",
      },
    ]) {
      const result = taskTool.execute?.(
        input,
        executionOptions({
          ...createContext({
            workingDirectory: "/repo",
            isolatedWorkspaceProvisioner,
          }),
          sessionId: "session-1",
        }),
      ) as AsyncIterable<unknown> | undefined;

      if (!result) {
        throw new Error("taskTool execute missing in test");
      }

      for await (const _output of result) {
        // Drain the worker.
      }
    }

    expect(launchedTasks).toEqual(["Inspect files", "Apply isolated change"]);
  });

  test("taskTool rejects shared write-capable workers when drift baseline is unsupported", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "task-no-git-"));
    mockToolLoopAgentStream = mock(() => {
      throw new Error("worker should not be launched");
    });

    const result = taskTool.execute?.(
      {
        subagentType: "executor",
        workspacePolicy: "shared",
        task: "Apply change",
        instructions: "Update the implementation.",
      },
      executionOptions({
        ...createContext({ workingDirectory: workspace }),
        sessionId: "session-1",
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    const outputs: unknown[] = [];
    await expect(async () => {
      for await (const output of result) {
        outputs.push(output);
      }
    }).toThrow("workspace_drift_detected");
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      delegatedWorkerLifecycle: {
        workerId: "tool-call-1",
        status: "blocked",
        reasonCode: "unsupported_workspace_baseline",
        workspaceMode: "shared",
      },
      delegatedWorkerLifecycleEvents: [
        {
          workerId: "tool-call-1",
          status: "blocked",
          reasonCode: "unsupported_workspace_baseline",
        },
      ],
      sharedWorkspaceDrift: {
        status: "unsupported",
        reasonCode: "unsupported_baseline",
      },
    });
    expect(mockToolLoopAgentStream).not.toHaveBeenCalled();
  });

  test("taskTool emits a failed lifecycle update when a delegated worker fails", async () => {
    const workspace = await createGitWorkspace();
    mockToolLoopAgentStream = mock(() => {
      throw new Error("worker exploded");
    });

    const result = taskTool.execute?.(
      {
        subagentType: "executor",
        workspacePolicy: "shared",
        task: "Apply change",
        instructions: "Update the implementation.",
      },
      executionOptions({
        ...createContext({ workingDirectory: workspace }),
        sessionId: "session-1",
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    const outputs: unknown[] = [];
    await expect(async () => {
      for await (const output of result) {
        outputs.push(output);
      }
    }).toThrow("worker exploded");

    expect(outputs.at(-1)).toMatchObject({
      delegatedWorkerLifecycle: {
        workerId: "tool-call-1",
        status: "failed",
        reasonCode: "worker_failed",
      },
      delegatedWorkerLifecycleEvents: [
        { status: "launching" },
        { status: "running" },
        { status: "failed" },
      ],
      sharedWriterLeaseRelease: {
        status: "released",
        events: [
          {
            type: "shared_writer_lock_released",
            reasonCode: "worker_failed",
          },
        ],
      },
      completionPacket: {
        status: "failed",
        workerId: "tool-call-1",
        workerType: "executor",
        workspaceMode: "shared",
        blockers: ["failed: worker_failed"],
        recoveryInstructions: [
          "Inspect worker lifecycle events and rerun after the blocker is fixed.",
        ],
      },
      completionPacketValidation: {
        status: "valid",
        reasonCode: "worker_completion_packet_validated",
      },
    });
  });

  test("taskTool reports an unreachable subagent model as a model failure, not workspace drift", async () => {
    const workspace = await createGitWorkspace();
    mockToolLoopAgentStream = mock(
      providerFailureStream({ error: new Error("fetch failed") }),
    );

    const result = taskTool.execute?.(
      {
        subagentType: "explorer",
        workspacePolicy: "shared",
        task: "Inspect files",
        instructions: "Summarize the repository.",
      },
      executionOptions({
        ...createContext({ workingDirectory: workspace }),
        sessionId: "session-model-failure",
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    let thrown: unknown;
    try {
      for await (const _output of result) {
        // drain
      }
    } catch (error) {
      thrown = error;
    }

    const message = (thrown as Error | undefined)?.message ?? "";
    expect(message).toContain("subagent_model_failed");
    expect(message).toContain("test-model");
    expect(message).toContain("fetch failed");
    expect(message).not.toContain("drift");
    expect(message).not.toContain("baseline");
  });

  // #1140: the AI SDK surfaces the provider's own failure as an `error` part on
  // fullStream, then rejects `response` with a generic no-output message. The
  // generic message is what reached users; the provider's message must survive.
  test("taskTool surfaces the provider error instead of the generic no-output message", async () => {
    const workspace = await createGitWorkspace();
    const providerError = new Error("HTTP 404 model_not_found");
    mockToolLoopAgentStream = mock(
      providerFailureStream({ error: providerError }),
    );

    const result = taskTool.execute?.(
      {
        subagentType: "explorer",
        workspacePolicy: "shared",
        task: "Inspect files",
        instructions: "Summarize the repository.",
      },
      executionOptions({
        ...createContext({ workingDirectory: workspace }),
        sessionId: "session-provider-error",
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    let thrown: unknown;
    try {
      for await (const _output of result) {
        // drain
      }
    } catch (error) {
      thrown = error;
    }

    const message = (thrown as Error | undefined)?.message ?? "";
    expect(message).toContain("HTTP 404 model_not_found");
    expect((thrown as Error | undefined)?.cause).toBe(providerError);
  });

  // #1140: the message reaching the user must not carry an unbounded provider
  // body or a credential echoed back in one.
  test("taskTool bounds and redacts the provider error it surfaces", async () => {
    const workspace = await createGitWorkspace();
    mockToolLoopAgentStream = mock(
      providerFailureStream({
        error: new Error(
          `unauthorized: Authorization: Bearer sk-live-abcdef123456 ${"x".repeat(4000)}`,
        ),
      }),
    );

    const result = taskTool.execute?.(
      {
        subagentType: "explorer",
        workspacePolicy: "shared",
        task: "Inspect files",
        instructions: "Summarize the repository.",
      },
      executionOptions({
        ...createContext({ workingDirectory: workspace }),
        sessionId: "session-provider-secret",
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    let thrown: unknown;
    try {
      for await (const _output of result) {
        // drain
      }
    } catch (error) {
      thrown = error;
    }

    const message = (thrown as Error | undefined)?.message ?? "";
    expect(message).not.toContain("sk-live-abcdef123456");
    expect(message.length).toBeLessThan(1000);
    expect(message).toContain("unauthorized");
  });

  // #1141: `start` is not the only part the SDK emits before the provider
  // responds — `start-step` does too. The guard must use an allowlist of
  // output-bearing parts so an unrecognized pre-output part fails safe.
  test("taskTool still attributes the model when start-step precedes the failure", async () => {
    const workspace = await createGitWorkspace();
    mockToolLoopAgentStream = mock(
      providerFailureStream({
        error: new Error("connection reset"),
        partsBeforeFailure: [{ type: "start-step" }],
      }),
    );

    const result = taskTool.execute?.(
      {
        subagentType: "explorer",
        workspacePolicy: "shared",
        task: "Inspect files",
        instructions: "Summarize the repository.",
      },
      executionOptions({
        ...createContext({ workingDirectory: workspace }),
        sessionId: "session-start-step",
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    let thrown: unknown;
    try {
      for await (const _output of result) {
        // drain
      }
    } catch (error) {
      thrown = error;
    }

    const message = (thrown as Error | undefined)?.message ?? "";
    expect(message).toContain("subagent_model_failed");
    expect(message).toContain("connection reset");
  });

  // #1140 follow-up: a provider can emit real output and *then* fail — a
  // partial response followed by a 5xx that echoes the request. That path
  // rethrows past the model-failure wrapper, so it needs its own sanitizing.
  test("taskTool sanitizes a provider error that arrives after output began", async () => {
    const workspace = await createGitWorkspace();
    mockToolLoopAgentStream = mock(
      providerFailureStream({
        error: new Error(
          "upstream 502: Authorization: Bearer sk-live-abcdef123456",
        ),
        partsBeforeFailure: [
          { type: "tool-call", toolName: "bash", input: {} },
        ],
      }),
    );

    const result = taskTool.execute?.(
      {
        subagentType: "explorer",
        workspacePolicy: "shared",
        task: "Inspect files",
        instructions: "Summarize the repository.",
      },
      executionOptions({
        ...createContext({ workingDirectory: workspace }),
        sessionId: "session-post-output-secret",
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    let thrown: unknown;
    try {
      for await (const _output of result) {
        // drain
      }
    } catch (error) {
      thrown = error;
    }

    const message = (thrown as Error | undefined)?.message ?? "";
    expect(message).not.toContain("sk-live-abcdef123456");
    expect(message).toContain("upstream 502");
    // Post-output, so this is NOT a model failure and must not claim to be.
    expect(message).not.toContain("subagent_model_failed");
  });

  test("taskTool preserves a non-model worker failure instead of blaming the model", async () => {
    const workspace = await createGitWorkspace();
    mockToolLoopAgentStream = mock(() => ({
      fullStream: (async function* () {
        yield { type: "tool-call", toolName: "bash", input: {} };
        throw new Error("bash tool exploded");
      })(),
      response: Promise.resolve({ messages: [] }),
      usage: Promise.resolve({}),
    }));

    const result = taskTool.execute?.(
      {
        subagentType: "executor",
        workspacePolicy: "shared",
        task: "Apply change",
        instructions: "Update the implementation.",
      },
      executionOptions({
        ...createContext({ workingDirectory: workspace }),
        sessionId: "session-tool-failure",
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    let thrown: unknown;
    try {
      for await (const _output of result) {
        // drain
      }
    } catch (error) {
      thrown = error;
    }

    const message = (thrown as Error | undefined)?.message ?? "";
    expect(message).toBe("bash tool exploded");
    expect(message).not.toContain("subagent_model_failed");
  });

  test("taskTool provisions an isolated child workspace before worker launch", async () => {
    const parentWorkspace = await createGitWorkspace();
    const childWorkspace = await mkdtemp(path.join(tmpdir(), "task-child-"));
    const finalMessages = [{ role: "assistant", content: "Done." }];
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    const provisionerCalls: unknown[] = [];
    const launchedSandboxes: unknown[] = [];

    const isolatedWorkspaceProvisioner = mock(async (input: unknown) => {
      provisionerCalls.push(input);
      return {
        sandbox: {
          state: { type: "vercel" as const, sandboxId: "child-sandbox" },
          workingDirectory: childWorkspace,
        },
        provenance: {
          parentWorkspaceId: "sandbox-1",
          childWorkspaceId: "child-sandbox",
          backendKind: "fake",
          createdAt: Date.now(),
        },
      };
    });

    mockToolLoopAgentStream = mock((args: Record<string, unknown>) => {
      const options = args.options as { sandbox?: unknown };
      launchedSandboxes.push(options.sandbox);
      return {
        fullStream: (async function* () {})(),
        response: Promise.resolve({ messages: finalMessages }),
        usage: Promise.resolve(usage),
      };
    });

    const result = taskTool.execute?.(
      {
        subagentType: "executor",
        workspacePolicy: "isolated",
        task: "Apply isolated change",
        instructions: "Update the implementation.",
      },
      executionOptions({
        ...createContext({
          workingDirectory: parentWorkspace,
          isolatedWorkspaceProvisioner,
        }),
        sessionId: "session-1",
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    const outputs: unknown[] = [];
    for await (const output of result) {
      outputs.push(output);
    }

    expect(provisionerCalls).toHaveLength(1);
    expect(provisionerCalls[0]).toMatchObject({
      parentWorkspaceId: "sandbox-1",
      workerId: "tool-call-1",
      sourceRef: expect.any(String),
      sourceCommit: expect.any(String),
    });
    expect(launchedSandboxes).toEqual([
      {
        state: { type: "vercel", sandboxId: "child-sandbox" },
        workingDirectory: childWorkspace,
      },
    ]);
    expect(outputs[0]).toMatchObject({
      delegatedWorkerLifecycle: {
        status: "launching",
        reasonCode: "isolated_workspace_creation_started",
        workspaceMode: "isolated",
      },
    });
    expect(outputs[1]).toMatchObject({
      isolatedWorkspace: {
        status: "created",
        parentWorkspaceId: "sandbox-1",
        childWorkspaceId: "child-sandbox",
        backendKind: "fake",
        sourceRef: expect.any(String),
        sourceCommit: expect.any(String),
      },
      delegatedWorkerLifecycle: {
        status: "launching",
        reasonCode: "isolated_workspace_creation_succeeded",
        workspaceId: "child-sandbox",
      },
    });
    expect(outputs.at(-1)).toMatchObject({
      isolatedWorkspace: {
        status: "created",
        childWorkspaceId: "child-sandbox",
      },
      delegatedWorkerLifecycle: {
        status: "completed",
        workspaceId: "child-sandbox",
      },
      completionPacket: {
        status: "completed",
        workerId: "tool-call-1",
        workerType: "executor",
        workspaceMode: "isolated",
        appliedToParentWorkspace: false,
        integrationInstructions: [
          "Review child workspace artifacts before applying changes to the parent workspace.",
          "Do not assume isolated child changes mutated the parent workspace.",
        ],
      },
      completionPacketValidation: {
        status: "valid",
        reasonCode: "worker_completion_packet_validated",
      },
    });
  });

  test("taskTool blocks isolated workers when no workspace provisioner is available", async () => {
    const parentWorkspace = await createGitWorkspace();
    mockToolLoopAgentStream = mock(() => {
      throw new Error("worker should not be launched");
    });

    const result = taskTool.execute?.(
      {
        subagentType: "executor",
        workspacePolicy: "isolated",
        task: "Apply isolated change",
        instructions: "Update the implementation.",
      },
      executionOptions({
        ...createContext({ workingDirectory: parentWorkspace }),
        sessionId: "session-1",
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    const outputs: unknown[] = [];
    await expect(async () => {
      for await (const output of result) {
        outputs.push(output);
      }
    }).toThrow("isolated_workspace_provisioner_unavailable");

    expect(outputs.at(-1)).toMatchObject({
      isolatedWorkspace: {
        status: "unsupported",
        reasonCode: "isolated_workspace_provisioner_unavailable",
        parentWorkspaceId: "sandbox-1",
      },
      delegatedWorkerLifecycle: {
        status: "blocked",
        reasonCode: "isolated_workspace_provisioner_unavailable",
        workspaceMode: "isolated",
      },
      completionPacket: {
        status: "blocked",
        workerType: "executor",
        workspaceMode: "isolated",
        blockers: ["blocked: isolated_workspace_provisioner_unavailable"],
      },
      completionPacketValidation: {
        status: "valid",
        reasonCode: "worker_completion_packet_validated",
      },
    });
    expect(mockToolLoopAgentStream).not.toHaveBeenCalled();
  });

  test("taskTool rejects invalid workspace policy before worker launch", async () => {
    mockToolLoopAgentStream = mock(() => {
      throw new Error("worker should not be launched");
    });

    const result = taskTool.execute?.(
      {
        subagentType: "executor",
        workspacePolicy: "private",
        task: "Apply change",
        instructions: "Update the implementation.",
      } as unknown as Parameters<NonNullable<typeof taskTool.execute>>[0],
      executionOptions(createContext({ workingDirectory: "/repo" })),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    await expect(async () => {
      for await (const _output of result) {
        // The invalid policy should throw before yielding.
      }
    }).toThrow("policy_validation_failed");
    expect(mockToolLoopAgentStream).not.toHaveBeenCalled();
  });

  test("delegated workspace policy schema accepts only known policies", () => {
    expect(delegatedWorkspacePolicySchema.parse("auto")).toBe("auto");
    expect(delegatedWorkspacePolicySchema.parse("shared")).toBe("shared");
    expect(delegatedWorkspacePolicySchema.parse("isolated")).toBe("isolated");
    expect(() => delegatedWorkspacePolicySchema.parse("private")).toThrow();
  });

  test("taskTool emits initial worker status before subagent stream startup completes", async () => {
    const finalMessages = [
      {
        role: "assistant",
        content: "Worker finished.",
      },
    ];
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    const workspace = await createGitWorkspace();
    let resolveStream:
      | ((stream: {
          fullStream: AsyncIterable<unknown>;
          response: Promise<{ messages: typeof finalMessages }>;
          usage: Promise<typeof usage>;
        }) => void)
      | undefined;

    mockToolLoopAgentStream = mock(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveStream = (stream) =>
            resolve(stream as unknown as Record<string, unknown>);
        }),
    );

    const result = taskTool.execute?.(
      {
        subagentType: "executor",
        task: "Apply change",
        instructions: "Update one file.",
      },
      executionOptions({
        sandbox: {
          workingDirectory: workspace,
        },
        model: { modelId: "test-model" },
        runtimeMode: "managed_runtime",
        managedRuntime: {
          profileDisplayName: "Web app with Bun and browser checks",
        },
      }),
    ) as AsyncIterable<unknown> | undefined;

    if (!result) {
      throw new Error("taskTool execute missing in test");
    }

    const iterator = result[Symbol.asyncIterator]();
    // This asserts ORDER, not speed: the first status must be yielded before
    // subagent.stream() resolves. The mocked stream never resolves on its own,
    // so a regression to await-before-yield makes iterator.next() unsettleable
    // and the sentinel wins.
    //
    // The sentinel was 250ms, which made this test load-flaky. The generator
    // does real git I/O before its first yield - measured at 92-99ms on an idle
    // machine, but enough over 250ms under parallel test load to fail
    // consistently while passing 5/5 when the file was run alone. The bound is
    // now far above any plausible I/O time, so it only fires on a real
    // ordering regression rather than on machine load.
    //
    // 2s, not 5s: Bun's default per-test timeout is also 5000ms, so a 5s
    // sentinel is a dead tie with the runner's own deadline — a real regression
    // would surface as an opaque test timeout instead of this assertion. 2s is
    // still 20x the measured worst case and safely inside the deadline.
    const pending = Symbol("pending");
    const firstOutput = await Promise.race([
      iterator.next(),
      new Promise((resolve) => setTimeout(() => resolve(pending), 2000)),
    ]);

    expect(firstOutput).not.toBe(pending);
    expect(firstOutput).toMatchObject({
      done: false,
      value: {
        toolCallCount: 0,
        modelId: "test-model",
        runtime: {
          mode: "managed_runtime",
          workerType: "executor",
          profileDisplayName: "Web app with Bun and browser checks",
        },
      },
    });

    const finalOutput = iterator.next();
    await Promise.resolve();

    if (!resolveStream) {
      throw new Error("Subagent stream was not requested after initial yield");
    }

    resolveStream({
      fullStream: (async function* () {})(),
      response: Promise.resolve({ messages: finalMessages }),
      usage: Promise.resolve(usage),
    });

    await expect(finalOutput).resolves.toMatchObject({
      done: false,
      value: {
        final: finalMessages,
        usage,
      },
    });
  });

  test("buildSystemPrompt lists subagents from the shared registry", () => {
    const prompt = buildSystemPrompt({});

    expect(prompt).toContain("Available subagents:");
    expect(prompt).toContain(
      "`explorer` - Use for read-only codebase exploration, tracing behavior, and answering questions without changing files",
    );
    expect(prompt).toContain(
      "`executor` - Use for well-scoped implementation work, including edits, scaffolding, refactors, and other file changes",
    );
  });

  test("todoWriteTool returns updated todo list metadata", async () => {
    const todos = [
      { id: "1", content: "Write tests", status: "in_progress" as const },
      { id: "2", content: "Run checks", status: "pending" as const },
    ];

    const result = await todoWriteTool.execute?.({ todos }, executionOptions());

    expect(result).toEqual({
      success: true,
      message: "Updated task list with 2 items",
      todos,
    });
  });
});
