import { describe, expect, test } from "bun:test";
import { detectJavaScriptPackageManager } from "./js-package-manager";

function createProbe(params: {
  files?: Record<string, string>;
  availableCommands?: string[];
}) {
  const files = new Map(Object.entries(params.files ?? {}));
  const availableCommands = new Set(params.availableCommands);

  return {
    workingDirectory: "/workspace",
    async access(targetPath: string) {
      if (!files.has(targetPath)) {
        throw new Error(`Missing path: ${targetPath}`);
      }
    },
    async readFile(targetPath: string) {
      const content = files.get(targetPath);
      if (content === undefined) {
        throw new Error(`Missing file: ${targetPath}`);
      }
      return content;
    },
    async exec(command: string) {
      const commandName = command.match(/^command -v '([^']+)'/)?.[1];
      return {
        success: commandName ? availableCommands.has(commandName) : false,
      };
    },
  };
}

describe("detectJavaScriptPackageManager", () => {
  test("chooses an available command when package metadata does not declare a manager", async () => {
    const sandbox = createProbe({
      files: {
        "/workspace/app/package.json": JSON.stringify({
          scripts: { dev: "vite" },
        }),
      },
      availableCommands: ["bun"],
    });

    await expect(
      detectJavaScriptPackageManager({
        sandbox,
        packageDirAbs: "/workspace/app",
        packageManagerField: undefined,
      }),
    ).resolves.toMatchObject({
      packageManager: "bun",
      installRootAbs: "/workspace/app",
      source: "available_command",
    });
  });

  test("requires the manager declared by a lockfile to be available", async () => {
    const sandbox = createProbe({
      files: {
        "/workspace/app/package.json": JSON.stringify({
          scripts: { dev: "vite" },
        }),
        "/workspace/bun.lock": "",
      },
      availableCommands: ["npm"],
    });

    await expect(
      detectJavaScriptPackageManager({
        sandbox,
        packageDirAbs: "/workspace/app",
        packageManagerField: undefined,
      }),
    ).rejects.toThrow(
      "Detected bun from /workspace/bun.lock, but bun is not available",
    );
  });
});
