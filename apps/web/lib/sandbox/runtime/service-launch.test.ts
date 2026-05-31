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
}));

const upsertSandboxServiceMock = mock(async (svc: unknown) => svc);
mock.module("@/lib/sandbox/runtime/service-records", () => ({
  getSandboxService: mock(async () => null),
  listSandboxServices: mock(async () => []),
  updateSandboxService: mock(async (_id: string, updates: unknown) => updates),
  upsertSandboxService: upsertSandboxServiceMock,
}));
mock.module("@/lib/sandbox/runtime/js-package-manager", () => ({
  detectJavaScriptPackageManager: mock(async () => ({
    packageManager: "bun",
    installRootAbs: "/sandbox",
    source: "lock-file",
    reason: "bun.lock found",
  })),
  INSTALL_COMMANDS: {
    bun: "bun install",
    npm: "npm install",
    pnpm: "pnpm install",
    yarn: "yarn install",
  },
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
    test("recipe env.PORT and dev.env.HOST do not override launcher-selected port and host", async () => {
      // Recipe deliberately tries to set PORT=9999 and HOST=127.0.0.1
      // The launcher should always use the resolved sandbox port (3000) and HOST=0.0.0.0
      const recipeContent = JSON.stringify({
        dev: {
          command: "bun run dev:sandbox",
          port: 3000,
          env: {
            HOST: "127.0.0.1", // attacker-controlled — should be rejected/ignored
          },
        },
        env: {
          PORT: "9999", // attacker-controlled — should be rejected/ignored
        },
      });

      const sandbox = makeSandbox({
        recipeContent,
        recipeAccessible: true,
      });

      // startManagedDevServer will either succeed or fail with a recipe parse error.
      // After the fix, parseSandboxRecipe should reject PORT/HOST, so this throws
      // a validation error — which is the CORRECT behavior per the fix plan.
      // If somehow it doesn't reject (bug still present), we check the launched command.
      let threw = false;
      try {
        await startManagedDevServer({
          session: SESSION,
          sandbox: sandbox as never,
        });
      } catch (err) {
        threw = true;
        // If it threw, it should be about reserved env keys, not a health timeout
        const msg = err instanceof Error ? err.message : String(err);
        // After fix: either parseSandboxRecipe rejects with "reserved" OR
        // the launch command does NOT contain the bad values.
        // We accept either outcome here — the specific behavior tests are in
        // BT-SL-002. Here we just assert the command (if launched) is clean.
        if (sandbox._launchedCommands.length > 0) {
          const launched = sandbox._launchedCommands[0];
          // The effective PORT must not be 9999
          expect(launched.command).not.toContain("PORT='9999'");
          // The effective HOST must not be 127.0.0.1
          expect(launched.command).not.toContain("HOST='127.0.0.1'");
        }
      }

      // If it did not throw, inspect the launched command
      if (!threw && sandbox._launchedCommands.length > 0) {
        const launched = sandbox._launchedCommands[0];
        expect(launched.command).not.toContain("PORT='9999'");
        expect(launched.command).not.toContain("HOST='127.0.0.1'");
        // Launcher-owned values must be present
        expect(launched.command).toContain("HOST='0.0.0.0'");
        expect(launched.command).toContain("PORT='3000'");
      }
    });

    test("a recipe without reserved keys launches with correct launcher-owned HOST and PORT", async () => {
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

      // Launcher-owned values must be set and not overridden
      expect(launched.command).toContain("HOST='0.0.0.0'");
      expect(launched.command).toContain("PORT='3000'");
      expect(launched.command).toContain("BROWSER='none'");

      // Recipe env values should also be present
      expect(launched.command).toContain("NEXT_TELEMETRY_DISABLED='1'");
      expect(launched.command).toContain("DATA_DIR='/data'");

      // Recipe env must appear BEFORE HOST/PORT/BROWSER so launcher values win
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
