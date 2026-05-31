import { describe, expect, test } from "bun:test";
import { parseSandboxRecipe } from "./sandbox-recipe";

describe("parseSandboxRecipe", () => {
  test("normalizes a repo-owned sandbox recipe", () => {
    const recipe = parseSandboxRecipe(
      JSON.stringify({
        version: 1,
        install: "bun install",
        build: [
          "bun run --filter @acme/db build",
          "bun run --filter @acme/web build",
        ],
        env: {
          PI_RUNTIME_NO_TMUX: "1",
        },
        dev: {
          command:
            "bun run --filter @acme/web dev -- --host 0.0.0.0 --port 3000",
          port: 3000,
          health: "api/health",
          cwd: "apps/web",
          env: {
            NEXT_TELEMETRY_DISABLED: "1",
          },
        },
      }),
      ".open-agents/sandbox.json",
    );

    expect(recipe).toEqual({
      recipePath: ".open-agents/sandbox.json",
      installCommands: ["bun install"],
      buildCommands: [
        "bun run --filter @acme/db build",
        "bun run --filter @acme/web build",
      ],
      env: {
        PI_RUNTIME_NO_TMUX: "1",
      },
      dev: {
        command: "bun run --filter @acme/web dev -- --host 0.0.0.0 --port 3000",
        port: 3000,
        healthPath: "/api/health",
        cwd: "apps/web",
        env: {
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
    });
  });

  test("requires an explicit dev command and exposed port", () => {
    expect(() =>
      parseSandboxRecipe(
        JSON.stringify({
          install: ["bun install"],
          dev: "bun run dev",
        }),
        ".open-agents/sandbox.json",
      ),
    ).toThrow("dev must be an object with command and port");

    expect(() =>
      parseSandboxRecipe(
        JSON.stringify({
          dev: {
            command: "bun run dev",
          },
        }),
        ".open-agents/sandbox.json",
      ),
    ).toThrow("dev.port must be a positive integer port");
  });

  test("rejects cwd escapes and invalid env names", () => {
    expect(() =>
      parseSandboxRecipe(
        JSON.stringify({
          dev: {
            command: "bun run dev",
            port: 3000,
            cwd: "../outside",
          },
        }),
        ".open-agents/sandbox.json",
      ),
    ).toThrow("dev.cwd must stay inside the repository");

    expect(() =>
      parseSandboxRecipe(
        JSON.stringify({
          env: {
            "not-valid": "1",
          },
          dev: {
            command: "bun run dev",
            port: 3000,
          },
        }),
        ".open-agents/sandbox.json",
      ),
    ).toThrow("not a valid environment variable");
  });

  test("rejects reserved launcher env keys in env and dev.env", () => {
    // PORT in dev.env
    expect(() =>
      parseSandboxRecipe(
        JSON.stringify({
          dev: { command: "bun run dev", port: 3000, env: { PORT: "9999" } },
        }),
        ".open-agents/sandbox.json",
      ),
    ).toThrow(/reserved/i);

    // HOST at root env
    expect(() =>
      parseSandboxRecipe(
        JSON.stringify({
          env: { HOST: "127.0.0.1" },
          dev: { command: "bun run dev", port: 3000 },
        }),
        ".open-agents/sandbox.json",
      ),
    ).toThrow(/reserved/i);

    // BROWSER in dev.env
    expect(() =>
      parseSandboxRecipe(
        JSON.stringify({
          dev: { command: "bun run dev", port: 3000, env: { BROWSER: "chromium" } },
        }),
        ".open-agents/sandbox.json",
      ),
    ).toThrow(/reserved/i);
  });

  test("rejects unknown version numbers", () => {
    expect(() =>
      parseSandboxRecipe(
        JSON.stringify({
          version: 2,
          dev: { command: "bun run dev", port: 3000 },
        }),
        ".open-agents/sandbox.json",
      ),
    ).toThrow(/version 2.*only version 1/i);
  });

  test("accepts version 1 and recipes without a version field", () => {
    // Explicit version: 1 is fine
    const recipeWithVersion = parseSandboxRecipe(
      JSON.stringify({
        version: 1,
        dev: { command: "bun run dev", port: 3000 },
      }),
      ".open-agents/sandbox.json",
    );
    expect(recipeWithVersion.dev.port).toBe(3000);

    // No version field is also fine (backward compat)
    const recipeWithoutVersion = parseSandboxRecipe(
      JSON.stringify({ dev: { command: "bun run dev", port: 3000 } }),
      ".open-agents/sandbox.json",
    );
    expect(recipeWithoutVersion.dev.port).toBe(3000);
  });
});
