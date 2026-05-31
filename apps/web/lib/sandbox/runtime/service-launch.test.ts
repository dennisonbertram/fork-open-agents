import { beforeEach, describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Minimal in-process stubs — we exercise the exported functions directly
// without touching the real database or sandbox network.
// ---------------------------------------------------------------------------

mock.module("server-only", () => ({}));

// Stub out the DB helpers so service-launch.ts can be imported
mock.module("@/lib/db/schema", () => ({}));

const emitSessionEventMock = mock(async () => undefined);
mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: emitSessionEventMock,
}));
mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_PORTS: [3000, 5173, 4321, 8000],
  DEFAULT_SANDBOX_TIMEOUT_MS: 5 * 60 * 60 * 1000,
  DEFAULT_SANDBOX_VCPUS: 4,
  EXTEND_TIMEOUT_DURATION_MS: 20 * 60 * 1000,
  SANDBOX_INACTIVITY_TIMEOUT_MS: 30 * 60 * 1000,
  SANDBOX_EXPIRES_BUFFER_MS: 10 * 1000,
  SANDBOX_LIFECYCLE_STALE_RUN_GRACE_MS: 2 * 60 * 1000,
  SANDBOX_LIFECYCLE_MIN_SLEEP_MS: 5 * 1000,
  CODE_SERVER_PORT: 8000,
  DEFAULT_WORKING_DIRECTORY: "/vercel/sandbox",
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID: undefined,
}));

const upsertSandboxServiceMock = mock(async (svc: unknown) => svc);
mock.module("@/lib/sandbox/runtime/service-records", () => ({
  getSandboxService: mock(async () => null),
  listSandboxServices: mock(async () => []),
  updateSandboxService: mock(async (_id: string, updates: unknown) => updates),
  upsertSandboxService: upsertSandboxServiceMock,
}));
mock.module("@/lib/sandbox/runtime/js-package-manager", () => ({
  detectJavaScriptPackageManager: mock(
    async (params: { sandbox: { workingDirectory: string }; packageDirAbs: string }) => ({
      packageManager: "bun",
      // Return the sandbox workingDirectory as installRootAbs so that the
      // install-staleness check in shouldInstallDependencies can compare
      // against the correct node_modules parent. Returning the packageDirAbs
      // itself is acceptable for recipe-less tests but breaks route tests.
      installRootAbs: params.sandbox?.workingDirectory ?? params.packageDirAbs,
      source: "lock-file",
      reason: "bun.lock found",
    }),
  ),
  INSTALL_COMMANDS: {
    bun: "bun install",
    npm: "npm install",
    pnpm: "pnpm install",
    yarn: "yarn install",
  },
  PACKAGE_MANAGER_LOCKFILES: [
    { manager: "bun", files: ["bun.lockb", "bun.lock"] },
    { manager: "pnpm", files: ["pnpm-lock.yaml", "pnpm-workspace.yaml"] },
    { manager: "yarn", files: ["yarn.lock"] },
    { manager: "npm", files: ["package-lock.json"] },
  ],
  getAncestorDirectories: (dir: string, root: string) => {
    const dirs = [];
    let current = dir;
    while (current.startsWith(root)) {
      dirs.push(current);
      const parent = current.split("/").slice(0, -1).join("/");
      if (parent === current) break;
      current = parent;
    }
    return dirs;
  },
  getPackageManagerLockfiles: (pm: string) => {
    const map: Record<string, string[]> = {
      bun: ["bun.lockb", "bun.lock"],
      pnpm: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
      yarn: ["yarn.lock"],
      npm: ["package-lock.json"],
    };
    return map[pm] ?? [];
  },
  parsePackageManagerName: mock((name: string) => name),
}));

// ---------------------------------------------------------------------------
// Sandbox mock factory — always responds to health check immediately
// ---------------------------------------------------------------------------

const WORKING_DIR = "/sandbox";
const FAKE_PID = "12345";

type MockSandboxOpts = {
  recipeContent?: string | null;
  recipeAccessible?: boolean;
  findOutput?: string;
  packageJsonContent?: Record<string, string>;
};

function makeSandbox(opts: MockSandboxOpts = {}) {
  const {
    recipeContent = null,
    recipeAccessible = false,
    findOutput = "./package.json\n",
    packageJsonContent = {
      "/sandbox/package.json": JSON.stringify({
        scripts: { dev: "next dev" },
        dependencies: { next: "15.0.0" },
      }),
    },
  } = opts;

  // Track what PID files have been "written"
  const pidFiles = new Map<string, string>();
  const launchedCommands: Array<{ command: string; cwd: string }> = [];

  const sandbox = {
    workingDirectory: WORKING_DIR,
    domain: mock((port: number) => `https://sb-${port}.example.com`),
    access: mock(async (filePath: string) => {
      if (
        recipeAccessible &&
        (filePath.includes(".open-agents/sandbox.json") ||
          filePath.includes(".agent/sandbox.json"))
      ) {
        return;
      }
      throw new Error(`ENOENT: ${filePath}`);
    }),
    readFile: mock(async (filePath: string) => {
      if (
        recipeAccessible &&
        recipeContent !== null &&
        (filePath.includes(".open-agents/sandbox.json") ||
          filePath.includes(".agent/sandbox.json"))
      ) {
        return recipeContent;
      }
      if (pidFiles.has(filePath)) {
        return pidFiles.get(filePath) as string;
      }
      const content = packageJsonContent[filePath];
      if (content !== undefined) {
        return content;
      }
      throw new Error(`ENOENT: ${filePath}`);
    }),
    exec: mock(async (command: string) => {
      if (command.includes("find .")) {
        return {
          success: true,
          exitCode: 0,
          stdout: findOutput,
          stderr: "",
          truncated: false,
        };
      }
      if (command.startsWith("kill -0 ")) {
        const pid = command.slice("kill -0 ".length).trim();
        return {
          success: pidFiles.has(`/sandbox/.open-agents-managed-dev-server-3000.pid`) &&
                  pidFiles.get(`/sandbox/.open-agents-managed-dev-server-3000.pid`)?.trim() === pid,
          exitCode: 0,
          stdout: "",
          stderr: "",
          truncated: false,
        };
      }
      if (command.startsWith("curl ")) {
        // Always respond healthy immediately to avoid 120s wait
        return {
          success: true,
          exitCode: 0,
          stdout: "200",
          stderr: "",
          truncated: false,
        };
      }
      if (command.includes("node_modules")) {
        // stat for install gating
        return { success: false, exitCode: 1, stdout: "", stderr: "ENOENT", truncated: false };
      }
      return {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        truncated: false,
      };
    }),
    execDetached: mock(async (command: string, cwd: string) => {
      launchedCommands.push({ command, cwd });
      // Simulate writing the PID file (the launch command does this via printf,
      // but since we mock exec, we do it here so getRunningPid can find it)
      const pidMatch = command.match(
        /printf '%s' "\$\$" > '([^']+\.open-agents-managed-dev-server-\d+\.pid)'/,
      );
      if (pidMatch?.[1]) {
        pidFiles.set(pidMatch[1], FAKE_PID);
      }
      return { commandId: "cmd-999" };
    }),
    writeFile: mock(async () => undefined),
    stat: mock(async () => {
      throw new Error("ENOENT");
    }),
    getState: () => ({ sandboxName: "test-sandbox" }),
    _launchedCommands: launchedCommands,
    _pidFiles: pidFiles,
  };

  return sandbox;
}

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------
const { startManagedDevServer } = await import(
  "@/lib/sandbox/runtime/service-launch"
);

const SESSION = { id: "sess-1", userId: "user-1" };

describe("service-launch recipe branch", () => {
  beforeEach(() => {
    upsertSandboxServiceMock.mockClear();
    emitSessionEventMock.mockClear();
  });

  // -------------------------------------------------------------------------
  // BT-SL-001: ENV precedence — launcher-owned PORT/HOST/BROWSER always win
  // -------------------------------------------------------------------------
  describe("BT-SL-001: ENV precedence — launcher-owned HOST/PORT cannot be overridden by recipe env", () => {
    test("recipe with reserved env keys is rejected — parseSandboxRecipe prevents overrides at parse time", async () => {
      // The two-layer defence: (1) parseSandboxRecipe rejects recipes that
      // declare PORT/HOST/BROWSER, and (2) the env spread puts launcher-owned
      // keys last. This test verifies layer 1 by confirming the parser rejects
      // recipes that would try to override launcher keys.
      const { parseSandboxRecipe } = await import(
        "@/lib/sandbox/runtime/sandbox-recipe"
      );

      // env.PORT at root level
      expect(() =>
        parseSandboxRecipe(
          JSON.stringify({
            env: { PORT: "9999" },
            dev: { command: "bun run dev", port: 3000 },
          }),
          ".open-agents/sandbox.json",
        ),
      ).toThrow(/reserved/i);

      // dev.env.HOST override attempt
      expect(() =>
        parseSandboxRecipe(
          JSON.stringify({
            dev: { command: "bun run dev", port: 3000, env: { HOST: "127.0.0.1" } },
          }),
          ".open-agents/sandbox.json",
        ),
      ).toThrow(/reserved/i);
    });

    test("a valid recipe launches with launcher-owned HOST/PORT/BROWSER last in env prefix", async () => {
      const recipeContent = JSON.stringify({
        dev: {
          command: "bun run dev:sandbox",
          port: 3000,
          env: {
            NEXT_TELEMETRY_DISABLED: "1",
          },
        },
        env: {
          DATA_DIR: "/data",
        },
      });

      const sandbox = makeSandbox({
        recipeContent,
        recipeAccessible: true,
      });

      await startManagedDevServer({
        session: SESSION,
        sandbox: sandbox as never,
      });

      expect(sandbox._launchedCommands.length).toBe(1);
      const launched = sandbox._launchedCommands[0];

      // Launcher-owned values must be present
      expect(launched.command).toContain("HOST='0.0.0.0'");
      expect(launched.command).toContain("PORT='3000'");
      expect(launched.command).toContain("BROWSER='none'");

      // Recipe env values should also be present
      expect(launched.command).toContain("NEXT_TELEMETRY_DISABLED='1'");
      expect(launched.command).toContain("DATA_DIR='/data'");

      // Recipe env must appear BEFORE HOST/PORT/BROWSER so launcher values win
      // (second layer of defence — important even with validation)
      const hostIdx = launched.command.indexOf("HOST='0.0.0.0'");
      const dataDirIdx = launched.command.indexOf("DATA_DIR='/data'");
      expect(dataDirIdx).toBeLessThan(hostIdx);
    });
  });

  // -------------------------------------------------------------------------
  // BT-SL-002: parseSandboxRecipe rejects reserved env keys
  // -------------------------------------------------------------------------
  describe("BT-SL-002: parseSandboxRecipe rejects reserved env keys (PORT, HOST, BROWSER)", () => {
    test("recipe with dev.env.PORT throws a clear validation error mentioning 'reserved'", async () => {
      const { parseSandboxRecipe } = await import(
        "@/lib/sandbox/runtime/sandbox-recipe"
      );

      expect(() =>
        parseSandboxRecipe(
          JSON.stringify({
            dev: {
              command: "bun run dev",
              port: 3000,
              env: { PORT: "9999" },
            },
          }),
          ".open-agents/sandbox.json",
        ),
      ).toThrow(/reserved/i);
    });

    test("recipe with env.HOST at root level throws a clear validation error", async () => {
      const { parseSandboxRecipe } = await import(
        "@/lib/sandbox/runtime/sandbox-recipe"
      );

      expect(() =>
        parseSandboxRecipe(
          JSON.stringify({
            env: { HOST: "127.0.0.1" },
            dev: { command: "bun run dev", port: 3000 },
          }),
          ".open-agents/sandbox.json",
        ),
      ).toThrow(/reserved/i);
    });

    test("recipe with dev.env.BROWSER throws a clear validation error", async () => {
      const { parseSandboxRecipe } = await import(
        "@/lib/sandbox/runtime/sandbox-recipe"
      );

      expect(() =>
        parseSandboxRecipe(
          JSON.stringify({
            dev: {
              command: "bun run dev",
              port: 3000,
              env: { BROWSER: "chromium" },
            },
          }),
          ".open-agents/sandbox.json",
        ),
      ).toThrow(/reserved/i);
    });
  });

  // -------------------------------------------------------------------------
  // BT-SL-003: Unsupported port in recipe throws with helpful message
  // -------------------------------------------------------------------------
  describe("BT-SL-003: Unsupported port in recipe yields a descriptive error", () => {
    test("recipe with dev.port not in supported set throws an error naming the allowed ports", async () => {
      const recipeContent = JSON.stringify({
        dev: {
          command: "bun run dev",
          port: 1234, // not in [3000, 5173, 4321, 8000]
        },
      });

      const sandbox = makeSandbox({
        recipeContent,
        recipeAccessible: true,
      });

      await expect(
        startManagedDevServer({ session: SESSION, sandbox: sandbox as never }),
      ).rejects.toThrow(/exposed sandbox ports/i);
    });
  });

  // -------------------------------------------------------------------------
  // BT-SL-004: healthPath propagation from recipe
  // -------------------------------------------------------------------------
  describe("BT-SL-004: healthPath from recipe is stored in the service record", () => {
    test("recipe dev.health path is propagated to the upserted service record", async () => {
      const recipeContent = JSON.stringify({
        dev: {
          command: "bun run dev:sandbox",
          port: 3000,
          health: "/api/health",
        },
      });

      const sandbox = makeSandbox({
        recipeContent,
        recipeAccessible: true,
      });

      await startManagedDevServer({
        session: SESSION,
        sandbox: sandbox as never,
      });

      const calls = upsertSandboxServiceMock.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const storedService = calls[0][0] as { healthPath: string };
      expect(storedService.healthPath).toBe("/api/health");
    });
  });
});

// ---------------------------------------------------------------------------
// BT-002: Malformed recipe falls back to package.json discovery, no 500
// ---------------------------------------------------------------------------
describe("BT-002: Malformed recipe falls back to package.json discovery", () => {
  test("given malformed .open-agents/sandbox.json and valid package.json, startManagedDevServer falls back to package.json candidate", async () => {
    const sandbox = makeSandbox({
      recipeContent: "this is not valid json {{{",
      recipeAccessible: true,
      findOutput: "./package.json\n",
      packageJsonContent: {
        "/sandbox/package.json": JSON.stringify({
          scripts: { dev: "next dev" },
          dependencies: { next: "15.0.0" },
        }),
      },
    });

    // Should NOT propagate the recipe parse error —
    // it should fall back to the package.json candidate and launch it.
    let thrownError: unknown = null;
    try {
      await startManagedDevServer({
        session: SESSION,
        sandbox: sandbox as never,
      });
    } catch (err) {
      thrownError = err;
    }

    // If an error was thrown, it must NOT be the recipe parse error
    if (thrownError !== null) {
      const msg =
        thrownError instanceof Error ? thrownError.message : String(thrownError);
      expect(msg).not.toMatch(/invalid sandbox recipe/i);
      expect(msg).not.toMatch(/not valid json/i);
    }

    // A launch must have been attempted (fallback to package.json succeeded)
    expect(sandbox._launchedCommands.length).toBeGreaterThan(0);
  });
});
