import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const portDomains = new Map<number, string>();
const missingPorts = new Set<number>();
type MockWaitResult = {
  exitCode: number;
  stdout: () => Promise<string>;
  stderr: () => Promise<string>;
};
type MockRunCommandResult = {
  exitCode?: number;
  cmdId: string;
  stdout: () => Promise<string>;
  stderr: () => Promise<string>;
  wait?: (params?: { signal?: AbortSignal }) => Promise<MockWaitResult>;
};
type MockRunCommandParams = {
  cmd?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

type MockSessionState = {
  sessionId?: string;
  status?:
    | "running"
    | "stopped"
    | "stopping"
    | "snapshotting"
    | "aborted"
    | "failed";
  timeout?: number;
  requestedAt?: Date;
  startedAt?: Date;
};

const createCalls: Array<Record<string, unknown>> = [];
const getCalls: Array<Record<string, unknown>> = [];
const updateNetworkPolicyCalls: Array<Record<string, unknown>> = [];
const runCommandCalls: MockRunCommandParams[] = [];
const writeFilesCalls: Array<{ path: string; content: Buffer }[]> = [];
const sdkStopCalls: Array<string> = [];
let readFileToBufferResult: Buffer | null = Buffer.from("");
let sdkStopImpl: (name: string) => Promise<void> = async () => {};

let runCommandMock = async (
  _params?: MockRunCommandParams,
): Promise<MockRunCommandResult> => ({
  exitCode: 0,
  cmdId: "cmd-1",
  stdout: async () => "",
  stderr: async () => "",
});
let lastRunCommandEnv: Record<string, string> | undefined;
let currentSessionStateFactory = (_name: string): MockSessionState => ({});

function domainForPort(port: number): string {
  if (missingPorts.has(port)) {
    throw new Error(`No route found for port ${port}`);
  }

  const domain = portDomains.get(port);
  if (!domain) {
    throw new Error(`No route found for port ${port}`);
  }

  return domain;
}

function buildRoutes() {
  return Array.from(portDomains.keys()).map((port) => {
    const domain = portDomains.get(port) ?? `https://sbx-${port}.vercel.run`;
    const subdomain = new URL(domain).host.replace(".vercel.run", "");
    return { port, subdomain };
  });
}

function buildMockSession(name: string, state: MockSessionState = {}) {
  return {
    sessionId: state.sessionId ?? `${name}-session`,
    status: state.status ?? "running",
    timeout: state.timeout ?? 300_000,
    requestedAt: state.requestedAt ?? new Date(),
    startedAt: state.startedAt ?? new Date(),
    routes: buildRoutes(),
    domain: (port: number) => domainForPort(port),
    runCommand: async (params: MockRunCommandParams) => {
      runCommandCalls.push(params);
      lastRunCommandEnv = params.env;
      return runCommandMock(params);
    },
    writeFiles: async (files: { path: string; content: Buffer }[]) => {
      writeFilesCalls.push(files);
    },
    readFileToBuffer: async (_opts: { path: string }) => {
      return readFileToBufferResult;
    },
    snapshot: async () => ({ snapshotId: "snap-created" }),
    stop: async () => {},
    extendTimeout: async () => {},
  };
}

const updateCalls: Record<string, unknown>[] = [];

function createMockSandboxSdk(name: string) {
  let session = buildMockSession(name, currentSessionStateFactory(name));

  return {
    name,
    get routes() {
      return buildRoutes();
    },
    domain: (port: number) => domainForPort(port),
    currentSession: () => {
      session = buildMockSession(name, currentSessionStateFactory(name));
      return session;
    },
    runCommand: async (params: MockRunCommandParams) => {
      runCommandCalls.push(params);
      lastRunCommandEnv = params.env;
      return runCommandMock(params);
    },
    updateNetworkPolicy: async (policy: Record<string, unknown>) => {
      updateNetworkPolicyCalls.push(policy);
    },
    writeFiles: async (files: { path: string; content: Buffer }[]) => {
      writeFilesCalls.push(files);
    },
    readFileToBuffer: async (_opts: { path: string }) => {
      return readFileToBufferResult;
    },
    stop: async () => {
      sdkStopCalls.push(name);
      await sdkStopImpl(name);
    },
    update: async (params: Record<string, unknown>) => {
      updateCalls.push(params);
    },
  };
}

mock.module("@vercel/sandbox", () => ({
  Sandbox: {
    create: async (params: Record<string, unknown>) => {
      createCalls.push(params);
      return createMockSandboxSdk(
        typeof params.name === "string" ? params.name : "generated-sandbox",
      );
    },
    get: async (params: Record<string, unknown>) => {
      getCalls.push(params);
      const sandboxName =
        typeof params.name === "string" ? params.name : "loaded-sandbox";
      return createMockSandboxSdk(sandboxName);
    },
  },
}));

let sandboxModule: typeof import("./sandbox");

beforeAll(async () => {
  sandboxModule = await import("./sandbox");
});

beforeEach(() => {
  createCalls.length = 0;
  getCalls.length = 0;
  updateNetworkPolicyCalls.length = 0;
  runCommandCalls.length = 0;
  writeFilesCalls.length = 0;
  sdkStopCalls.length = 0;
  sdkStopImpl = async () => {};
  readFileToBufferResult = Buffer.from("");
  portDomains.clear();
  missingPorts.clear();
  portDomains.set(80, "https://sbx-80.vercel.run");
  runCommandMock = async () => ({
    exitCode: 0,
    cmdId: "cmd-1",
    stdout: async () => "",
    stderr: async () => "",
  });
  lastRunCommandEnv = undefined;
  currentSessionStateFactory = () => ({});
});

describe("VercelSandbox.environmentDetails", () => {
  test("skips dev server URLs for ports that are missing routes", async () => {
    portDomains.set(3000, "https://sbx-3000.vercel.run");
    missingPorts.add(5173);

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000, 5173],
      remainingTimeout: 0,
    });

    const details = sandbox.environmentDetails;

    expect(details).toContain(
      "Runtime tool availability depends on the base snapshot and active profile",
    );
    expect(details).toContain("command -v <tool>");
    expect(details).toContain("Dev server URLs for locally running servers");
    expect(details).toContain("Port 3000: https://sbx-3000.vercel.run");
    expect(details).not.toContain("Port 5173:");
  });

  test("uses first routable declared port for host when port 80 is unavailable", async () => {
    missingPorts.add(80);
    portDomains.set(3000, "https://sbx-3000.vercel.run");

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000, 5173],
      remainingTimeout: 0,
    });

    expect(sandbox.host).toBe("sbx-3000.vercel.run");
  });

  test("does not render an undefined host in environment details", async () => {
    missingPorts.add(80);
    missingPorts.add(3000);

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    const details = sandbox.environmentDetails;

    expect(details).not.toContain("Sandbox host: undefined");
    expect(details).not.toContain("Sandbox host:");
  });

  test("resolves host from SDK routes when reconnect did not pass ports", async () => {
    missingPorts.add(80);
    portDomains.set(3000, "https://sbx-3000.vercel.run");

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      remainingTimeout: 0,
    });

    expect(sandbox.host).toBe("sbx-3000.vercel.run");
    expect(sandbox.environmentDetails).toContain(
      "Sandbox host: sbx-3000.vercel.run",
    );
  });

  test("injects runtime preview env vars into command execution", async () => {
    missingPorts.add(80);
    portDomains.set(3000, "https://sbx-3000.vercel.run");

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    await sandbox.exec("echo test", "/vercel/sandbox", 5_000);

    expect(lastRunCommandEnv?.SANDBOX_HOST).toBe("sbx-3000.vercel.run");
    expect(lastRunCommandEnv?.SANDBOX_URL_3000).toBe(
      "https://sbx-3000.vercel.run",
    );
  });
});

describe("VercelSandbox.exec", () => {
  test("preserves stderr output from failed commands", async () => {
    runCommandMock = async () => ({
      exitCode: 128,
      cmdId: "cmd-fetch-failed",
      stdout: async () => "",
      stderr: async () => "fatal: couldn't find remote ref feature\n",
    });

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    const result = await sandbox.exec(
      "git fetch origin feature",
      "/vercel/sandbox",
      5_000,
    );

    expect(result).toEqual({
      success: false,
      exitCode: 128,
      stdout: "",
      stderr: "fatal: couldn't find remote ref feature\n",
      truncated: false,
    });
  });
});

describe("VercelSandbox persistence", () => {
  test("connects by persistent sandbox name without auto-resume by default", async () => {
    const sandbox = await sandboxModule.VercelSandbox.connect("session_123", {
      remainingTimeout: 0,
    });

    expect(getCalls[0]).toEqual({ name: "session_123", resume: false });
    expect(sandbox.getState()).toEqual(
      expect.objectContaining({
        type: "vercel",
        sandboxName: "session_123",
      }),
    );
  });

  test("persists sandboxName in state for created sandboxes", async () => {
    const sandbox = await sandboxModule.VercelSandbox.create({
      name: "session_123",
    });

    expect(createCalls[0]).toEqual(
      expect.objectContaining({
        name: "session_123",
        persistent: true,
      }),
    );
    expect(sandbox.getState()).toEqual(
      expect.objectContaining({
        type: "vercel",
        sandboxName: "session_123",
      }),
    );
  });

  test("marks connect() as a resume (wasCreated is false)", async () => {
    const sandbox = await sandboxModule.VercelSandbox.connect("session_123", {
      remainingTimeout: 0,
    });

    expect(sandbox.wasCreated).toBe(false);
  });

  test("marks create() as a fresh workspace (wasCreated is true)", async () => {
    const sandbox = await sandboxModule.VercelSandbox.create({
      name: "session_123",
    });

    expect(sandbox.wasCreated).toBe(true);
  });

  test("derives resumed expiresAt without the provider stop buffer", async () => {
    const startedAt = new Date();
    currentSessionStateFactory = () => ({
      timeout: 330_000,
      requestedAt: startedAt,
      startedAt,
    });

    const before = Date.now();
    const sandbox = await sandboxModule.VercelSandbox.connect("session_123");
    const remaining = (sandbox.expiresAt ?? 0) - before;

    expect(remaining).toBeGreaterThan(298_000);
    expect(remaining).toBeLessThanOrEqual(300_000);
  });

  test("refreshes state when the current session changes from stopped to running", async () => {
    const stoppedAt = new Date(Date.now() - 60_000);
    currentSessionStateFactory = () => ({
      sessionId: "session_123-stopped",
      status: "stopped",
      timeout: 330_000,
      requestedAt: stoppedAt,
      startedAt: stoppedAt,
    });

    const sandbox = await sandboxModule.VercelSandbox.connect("session_123");
    expect(sandbox.status).toBe("stopped");

    const resumedAt = new Date();
    currentSessionStateFactory = () => ({
      sessionId: "session_123-running",
      status: "running",
      timeout: 330_000,
      requestedAt: resumedAt,
      startedAt: resumedAt,
    });

    const state = sandbox.getState();
    const remaining = (state.expiresAt ?? 0) - Date.now();

    expect(sandbox.status).toBe("ready");
    expect(state).toEqual(
      expect.objectContaining({
        type: "vercel",
        sandboxName: "session_123",
        expiresAt: expect.any(Number),
      }),
    );
    expect(remaining).toBeGreaterThan(298_000);
    expect(remaining).toBeLessThanOrEqual(300_000);
  });
});

function captureWarnEvents(): {
  events: Array<Record<string, unknown>>;
  restore: () => void;
} {
  const events: Array<Record<string, unknown>> = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && first.startsWith("{")) {
      events.push(JSON.parse(first) as Record<string, unknown>);
    }
  };
  return {
    events,
    restore: () => {
      console.warn = originalWarn;
    },
  };
}

/**
 * #1395 defect 3 — stop() used to latch `isStopped = true` before calling
 * `sdk.stop()`. If the SDK call threw, the instance was permanently marked
 * stopped and every subsequent stop() call was a silent no-op, leaking the
 * VM forever. The latch must only flip after sdk.stop() actually resolves.
 */
describe("VercelSandbox.stop", () => {
  test("throws once, and a second stop() call still invokes sdk.stop()", async () => {
    let stopAttempts = 0;
    sdkStopImpl = async () => {
      stopAttempts += 1;
      if (stopAttempts === 1) {
        throw new Error("stop failed transiently");
      }
    };

    const sandbox = await sandboxModule.VercelSandbox.connect(
      "session_stop-retry",
      { remainingTimeout: 0 },
    );

    const warned = captureWarnEvents();
    try {
      await expect(sandbox.stop()).rejects.toThrow("stop failed transiently");
      expect(sdkStopCalls).toEqual(["session_stop-retry"]);
      expect(warned.events).toContainEqual(
        expect.objectContaining({
          service: "sandbox",
          event: "sandbox-stop-retryable",
          level: "warn",
          sandboxName: "session_stop-retry",
          errorKind: "stop_failed_retryable",
          errorName: "Error",
        }),
      );
    } finally {
      warned.restore();
    }

    await sandbox.stop();

    expect(sdkStopCalls).toEqual(["session_stop-retry", "session_stop-retry"]);
    expect(stopAttempts).toBe(2);
  });

  test("is idempotent after a successful stop", async () => {
    const sandbox = await sandboxModule.VercelSandbox.connect(
      "session_stop-once",
      { remainingTimeout: 0 },
    );

    await sandbox.stop();
    await sandbox.stop();

    expect(sdkStopCalls).toEqual(["session_stop-once"]);
  });
});

describe("GitHub setup credential brokering", () => {
  test("applies setup GitHub auth when creating a sandbox and then clears it", async () => {
    const basicAuthToken = Buffer.from(
      "x-access-token:github-user-token",
      "utf-8",
    ).toString("base64");

    await sandboxModule.VercelSandbox.create({
      githubToken: "github-user-token",
      source: {
        url: "https://github.com/open-agents/example",
        branch: "main",
      },
    });

    expect(createCalls[0]?.networkPolicy).toEqual({
      allow: {
        "api.github.com": [
          {
            transform: [
              { headers: { Authorization: "Bearer github-user-token" } },
            ],
          },
        ],
        "uploads.github.com": [
          {
            transform: [
              { headers: { Authorization: "Bearer github-user-token" } },
            ],
          },
        ],
        "codeload.github.com": [
          {
            transform: [
              { headers: { Authorization: "Bearer github-user-token" } },
            ],
          },
        ],
        "github.com": [
          {
            transform: [
              {
                headers: {
                  Authorization: `Basic ${basicAuthToken}`,
                },
              },
            ],
          },
        ],
        "*": [],
      },
    });
    expect(createCalls[0]?.source).toEqual({
      type: "git",
      url: "https://github.com/open-agents/example",
      depth: 1,
      revision: "main",
    });
    expect(updateNetworkPolicyCalls).toEqual([{ allow: { "*": [] } }]);
  });

  test("clears GitHub auth when reconnecting to a sandbox", async () => {
    await sandboxModule.VercelSandbox.connect("session_123", {
      githubToken: "github-user-token",
      remainingTimeout: 0,
    });

    expect(updateNetworkPolicyCalls).toEqual([{ allow: { "*": [] } }]);
  });

  test("does not clear GitHub auth when reconnecting without a brokered token", async () => {
    await sandboxModule.VercelSandbox.connect("session_123", {
      remainingTimeout: 0,
    });

    expect(updateNetworkPolicyCalls).toEqual([]);
  });
});

describe("VercelSandbox.create", () => {
  test("shallow-clones the git source from a base snapshot in one round-trip", async () => {
    await sandboxModule.VercelSandbox.create({
      baseSnapshotId: "snap-base-1",
      source: {
        url: "https://github.com/open-agents/example",
        branch: "main",
      },
    });

    expect(createCalls.length).toBe(1);
    expect(createCalls[0]?.source).toEqual({
      type: "snapshot",
      snapshotId: "snap-base-1",
    });
    const setupCalls = runCommandCalls.filter((c) => c.cmd === "bash");
    expect(setupCalls).toEqual([
      {
        cmd: "bash",
        args: [
          "-c",
          "git clone --depth=1 --single-branch --branch 'main' 'https://github.com/open-agents/example' .",
        ],
        cwd: "/vercel/sandbox",
      },
    ]);
  });

  test("combines shallow clone, git config, and branch checkout into one round-trip", async () => {
    await sandboxModule.VercelSandbox.create({
      baseSnapshotId: "snap-base-1",
      gitUser: { name: "AI Agent", email: "agent@example.com" },
      source: {
        url: "https://github.com/open-agents/example",
        branch: "main",
        newBranch: "agent/work",
      },
    });

    const setupCalls = runCommandCalls.filter((c) => c.cmd === "bash");
    expect(setupCalls.length).toBe(1);
    expect(setupCalls[0]).toEqual({
      cmd: "bash",
      args: [
        "-c",
        "git clone --depth=1 --single-branch --branch 'main' 'https://github.com/open-agents/example' . && " +
          "git config user.name 'AI Agent' && " +
          "git config user.email 'agent@example.com' && " +
          "git checkout -b 'agent/work'",
      ],
      cwd: "/vercel/sandbox",
    });
  });

  test("shallow-clones the native git source and sets up in one round-trip", async () => {
    await sandboxModule.VercelSandbox.create({
      gitUser: { name: "AI Agent", email: "agent@example.com" },
      source: {
        url: "https://github.com/open-agents/example",
        branch: "main",
        newBranch: "agent/work",
      },
    });

    expect(createCalls[0]?.source).toEqual({
      type: "git",
      url: "https://github.com/open-agents/example",
      depth: 1,
      revision: "main",
    });
    const setupCalls = runCommandCalls.filter((c) => c.cmd === "bash");
    expect(setupCalls).toEqual([
      {
        cmd: "bash",
        args: [
          "-c",
          "git config user.name 'AI Agent' && " +
            "git config user.email 'agent@example.com' && " +
            "git checkout -b 'agent/work'",
        ],
        cwd: "/vercel/sandbox",
      },
    ]);
  });

  test("performs a FULL clone from base snapshot when cloneDepth is 0", async () => {
    await sandboxModule.VercelSandbox.create({
      baseSnapshotId: "snap-base-1",
      cloneDepth: 0,
      source: {
        url: "https://github.com/open-agents/example",
        branch: "main",
      },
    });

    const setupCalls = runCommandCalls.filter((c) => c.cmd === "bash");
    expect(setupCalls).toEqual([
      {
        cmd: "bash",
        args: [
          "-c",
          "git clone --branch 'main' 'https://github.com/open-agents/example' .",
        ],
        cwd: "/vercel/sandbox",
      },
    ]);
  });

  test("performs a FULL clone on the native git source when cloneDepth is 0", async () => {
    await sandboxModule.VercelSandbox.create({
      cloneDepth: 0,
      source: {
        url: "https://github.com/open-agents/example",
        branch: "main",
      },
    });

    expect(createCalls[0]?.source).toEqual({
      type: "git",
      url: "https://github.com/open-agents/example",
      revision: "main",
    });
  });

  test("throws with stderr when workspace setup fails", async () => {
    runCommandMock = async () => ({
      exitCode: 128,
      cmdId: "cmd-clone-failed",
      stdout: async () => "",
      stderr: async () => "fatal: repository not found\n",
    });

    expect(
      sandboxModule.VercelSandbox.create({
        baseSnapshotId: "snap-base-1",
        source: {
          url: "https://github.com/open-agents/missing",
          branch: "main",
        },
      }),
    ).rejects.toThrow("fatal: repository not found");
  });

  // #1395 defect 1 — a setup failure must not leak the freshly created SDK
  // sandbox. create() has to stop it best-effort before rethrowing, or the
  // VM keeps running and billing until the platform timeout.
  test("stops the freshly created sandbox best-effort when setup fails", async () => {
    runCommandMock = async () => ({
      exitCode: 1,
      cmdId: "cmd-setup-failed",
      stdout: async () => "",
      stderr: async () => "fatal: setup failed\n",
    });

    const warned = captureWarnEvents();
    try {
      await expect(
        sandboxModule.VercelSandbox.create({
          name: "session_setup-fail",
          baseSnapshotId: "snap-base-1",
          source: {
            url: "https://github.com/open-agents/example",
            branch: "main",
          },
        }),
      ).rejects.toThrow("fatal: setup failed");

      expect(sdkStopCalls).toEqual(["session_setup-fail"]);
      expect(warned.events).toContainEqual(
        expect.objectContaining({
          service: "sandbox",
          event: "sandbox-orphan-prevented",
          level: "warn",
          sandboxName: "session_setup-fail",
          stage: "create",
          errorKind: "setup_failed_stopped",
        }),
      );
    } finally {
      warned.restore();
    }
  });

  // #1395 defect 1 — same class of leak when hooks.afterStart throws after
  // the sandbox has otherwise finished setup successfully.
  test("stops the freshly created sandbox best-effort when afterStart throws", async () => {
    const warned = captureWarnEvents();
    try {
      await expect(
        sandboxModule.VercelSandbox.create({
          name: "session_after-start-fail",
          hooks: {
            afterStart: async () => {
              throw new Error("afterStart blew up");
            },
          },
        }),
      ).rejects.toThrow("afterStart blew up");

      expect(sdkStopCalls).toEqual(["session_after-start-fail"]);
      expect(warned.events).toContainEqual(
        expect.objectContaining({
          service: "sandbox",
          event: "sandbox-orphan-prevented",
          level: "warn",
          sandboxName: "session_after-start-fail",
          stage: "afterStart",
          errorKind: "after_start_failed_stopped",
        }),
      );
    } finally {
      warned.restore();
    }
  });

  // #1395 defect 1 — a throw between setting up GitHub credential brokering
  // and clearing it must still clear the policy so an orphaned VM never
  // keeps a token-brokered network policy active.
  test("clears GitHub credential brokering even when setup fails", async () => {
    runCommandMock = async () => ({
      exitCode: 1,
      cmdId: "cmd-setup-failed",
      stdout: async () => "",
      stderr: async () => "fatal: setup failed\n",
    });

    await expect(
      sandboxModule.VercelSandbox.create({
        name: "session_github-cleanup",
        githubToken: "github-user-token",
        baseSnapshotId: "snap-base-1",
        source: {
          url: "https://github.com/open-agents/example",
          branch: "main",
        },
      }),
    ).rejects.toThrow("fatal: setup failed");

    expect(updateNetworkPolicyCalls).toEqual([{ allow: { "*": [] } }]);
  });

  test("creates empty git repo from base snapshot", async () => {
    await sandboxModule.VercelSandbox.create({
      baseSnapshotId: "snap-base-1",
    });

    expect(createCalls.length).toBe(1);
    expect(createCalls[0]?.source).toEqual({
      type: "snapshot",
      snapshotId: "snap-base-1",
    });
    expect(runCommandCalls[0]).toEqual({
      cmd: "bash",
      args: ["-c", "git init"],
      cwd: "/vercel/sandbox",
    });
  });

  test("skips git workspace bootstrap from base snapshot when requested", async () => {
    await sandboxModule.VercelSandbox.create({
      baseSnapshotId: "snap-base-1",
      skipGitWorkspaceBootstrap: true,
    });

    expect(createCalls.length).toBe(1);
    expect(createCalls[0]?.source).toEqual({
      type: "snapshot",
      snapshotId: "snap-base-1",
    });
    expect(
      runCommandCalls.filter((c) => c.cmd === "git" || c.cmd === "bash"),
    ).toEqual([]);
  });
});

describe("VercelSandbox.execDetached", () => {
  test("returns commandId when quick-failure timer elapses before command exits", async () => {
    runCommandMock = async () => ({
      cmdId: "cmd-detached-running",
      stdout: async () => "",
      stderr: async () => "",
      wait: async () => await new Promise<MockWaitResult>(() => {}),
    });

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((
      handler: Parameters<typeof setTimeout>[0],
      _timeout?: Parameters<typeof setTimeout>[1],
      ...args: unknown[]
    ) => {
      if (typeof handler === "function") {
        handler();
      }
      return originalSetTimeout(() => undefined, 0, ...args);
    }) as typeof setTimeout;

    try {
      const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
        ports: [3000],
        remainingTimeout: 0,
      });

      const result = await sandbox.execDetached(
        "bun run dev",
        "/vercel/sandbox",
      );

      expect(result).toEqual({ commandId: "cmd-detached-running" });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("throws when detached wait fails before timer elapses", async () => {
    runCommandMock = async () => ({
      cmdId: "cmd-detached-error",
      stdout: async () => "",
      stderr: async () => "",
      wait: async () => {
        throw new Error("wait failed");
      },
    });

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    expect(
      sandbox.execDetached("bun run dev", "/vercel/sandbox"),
    ).rejects.toThrow("wait failed");
  });

  test("throws with stderr when command exits quickly with non-zero code", async () => {
    runCommandMock = async () => ({
      cmdId: "cmd-detached-fail",
      stdout: async () => "",
      stderr: async () => "",
      wait: async () => ({
        exitCode: 1,
        stdout: async () => "",
        stderr: async () => "npm ERR! code ENOENT",
      }),
    });

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    expect(
      sandbox.execDetached("npm run dev", "/vercel/sandbox"),
    ).rejects.toThrow("npm ERR! code ENOENT");
  });
});

describe("VercelSandbox.readFile", () => {
  test("returns file content as a string via sdk.readFileToBuffer", async () => {
    readFileToBufferResult = Buffer.from("hello world", "utf-8");

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    const content = await sandbox.readFile("/vercel/sandbox/test.txt", "utf-8");

    expect(content).toBe("hello world");
  });

  test("throws when the file does not exist", async () => {
    readFileToBufferResult = null;

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    expect(
      sandbox.readFile("/vercel/sandbox/missing.txt", "utf-8"),
    ).rejects.toThrow("Failed to read file");
  });

  test("preserves multi-byte UTF-8 content", async () => {
    const original = "日本語テスト 🚀 émojis";
    readFileToBufferResult = Buffer.from(original, "utf-8");

    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    const content = await sandbox.readFile("/vercel/sandbox/utf8.txt", "utf-8");

    expect(content).toBe(original);
  });
});

describe("VercelSandbox.writeFile", () => {
  test("delegates to sdk.writeFiles with a Buffer", async () => {
    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    await sandbox.writeFile("/vercel/sandbox/out.txt", "file content", "utf-8");

    expect(writeFilesCalls.length).toBe(1);
    expect(writeFilesCalls[0]?.[0]?.path).toBe("/vercel/sandbox/out.txt");
    expect(writeFilesCalls[0]?.[0]?.content.toString("utf-8")).toBe(
      "file content",
    );
  });

  test("creates parent directory via mkdir before writing", async () => {
    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    await sandbox.writeFile(
      "/vercel/sandbox/deep/nested/file.txt",
      "nested",
      "utf-8",
    );

    // mkdir should have been called (via runCommand) for the parent dir
    const mkdirCall = runCommandCalls.find(
      (c) =>
        c.cmd === "mkdir" ||
        (c.cmd === "bash" && c.args?.some((a) => a.includes("mkdir"))),
    );
    expect(mkdirCall).toBeDefined();

    // writeFiles should still have been called
    expect(writeFilesCalls.length).toBe(1);
  });

  test("handles large content without using runCommand for the write", async () => {
    const sandbox = await sandboxModule.VercelSandbox.connect("sbx-test", {
      ports: [3000],
      remainingTimeout: 0,
    });

    // Simulate a large file (200KB)
    const largeContent = "x".repeat(200_000);

    await sandbox.writeFile("/vercel/sandbox/large.txt", largeContent, "utf-8");

    // The write itself should go through writeFiles, not runCommand
    expect(writeFilesCalls.length).toBe(1);
    expect(writeFilesCalls[0]?.[0]?.content.length).toBe(200_000);

    // runCommand should NOT have been called with base64 content
    const base64Call = runCommandCalls.find(
      (c) => c.cmd === "bash" && c.args?.some((a) => a.includes("base64")),
    );
    expect(base64Call).toBeUndefined();
  });
});

/**
 * #1210 defect 3 — snapshot expiry has to survive a resume.
 *
 * Stopping a persistent sandbox writes a snapshot, and `snapshotExpiration` is
 * what bounds how long that snapshot is stored. It was passed only at creation,
 * so the FIRST run of a named sandbox carried it and every reconnect afterwards
 * silently did not — and background agents and hibernated sessions both reach
 * their sandbox through the resume path, which is precisely where most stops
 * (and therefore most snapshots) happen.
 *
 * Vercel's SDK exposes `update({ snapshotExpiration })` for a live sandbox,
 * which is the only way to set it on a sandbox that already exists.
 */
describe("snapshot expiry on the resume path", () => {
  test("connect applies snapshotExpiration to the resumed sandbox", async () => {
    updateCalls.length = 0;
    const { VercelSandbox } = await import("./sandbox");

    await VercelSandbox.connect("session_expiry-test", {
      resume: true,
      snapshotExpiration: 604_800_000,
    });

    expect(updateCalls).toContainEqual({ snapshotExpiration: 604_800_000 });
  });

  test("connect leaves the sandbox alone when no expiry is configured", async () => {
    updateCalls.length = 0;
    const { VercelSandbox } = await import("./sandbox");

    await VercelSandbox.connect("session_no-expiry", { resume: true });

    expect(updateCalls).toEqual([]);
  });
});

/**
 * The wiring between the two, which the class-level test above cannot see.
 *
 * `connectVercel` is what every caller in the app actually uses, so an option
 * that stops at its boundary never reaches a real sandbox. Removing the
 * forwarding left every other test in this package green.
 */
describe("connectVercel forwards snapshot expiry to a resumed sandbox", () => {
  test("a named sandbox reconnect carries the configured expiry", async () => {
    updateCalls.length = 0;
    const { connectVercel } = await import("./connect");

    await connectVercel(
      { sandboxName: "session_wiring-test" },
      { resume: true, snapshotExpiration: 604_800_000 },
    );

    expect(updateCalls).toContainEqual({ snapshotExpiration: 604_800_000 });
  });
});
