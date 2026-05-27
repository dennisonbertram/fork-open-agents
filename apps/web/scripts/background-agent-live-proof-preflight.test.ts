import { describe, expect, test } from "bun:test";
import type { EnvAuditResult } from "./background-agent-vercel-env-audit";
import {
  runLiveProofPreflight,
  type LiveProofPreflightOptions,
} from "./background-agent-live-proof-preflight";

const readyAudit: EnvAuditResult = {
  environment: "production",
  requireAllowlist: true,
  ready: true,
  missing: [],
  checks: [],
  notes: ["This audit checks names only."],
};

const missingAudit: EnvAuditResult = {
  environment: "production",
  requireAllowlist: true,
  ready: false,
  missing: [
    "BACKGROUND_AGENTS_ALLOWED_REPOS",
    "BACKGROUND_AGENTS_ENABLED",
    "BACKGROUND_AGENTS_WEBHOOK_SECRET",
  ],
  checks: [],
  notes: ["This audit checks names only."],
};

function command(stdout: unknown, status = 0) {
  return {
    status,
    stdout: JSON.stringify(stdout),
    stderr: "",
  };
}

function options(
  overrides: Partial<LiveProofPreflightOptions> = {},
): LiveProofPreflightOptions {
  return {
    environment: "production",
    verifyValues: false,
    ...overrides,
  };
}

describe("background-agent-live-proof-preflight", () => {
  test("reports missing hosted env, target URL, and disposable repo without secrets", async () => {
    const result = await runLiveProofPreflight(options(), {
      runCommand: () => command(missingAudit, 1),
      fetch: async () => new Response(null, { status: 401 }),
    });

    expect(result.ready).toBe(false);
    expect(result.checks.find((check) => check.id === "vercel_env")).toEqual(
      expect.objectContaining({
        status: "missing",
        missing: missingAudit.missing,
      }),
    );
    expect(
      result.checks.find((check) => check.id === "readiness_route"),
    ).toEqual(
      expect.objectContaining({
        status: "missing",
        missing: ["target deployment URL"],
      }),
    );
    expect(
      result.checks.find((check) => check.id === "disposable_repo"),
    ).toEqual(
      expect.objectContaining({
        status: "missing",
        missing: ["disposable owner/repo"],
      }),
    );
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  test("passes automated checks when env is ready, route is protected, and repo is accessible", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = await runLiveProofPreflight(
      options({
        baseUrl: "https://open-agents.example.com",
        repo: "acme/widgets",
        verifyValues: true,
      }),
      {
        runCommand: (commandName, args) => {
          calls.push({ command: commandName, args });
          if (commandName === "bun") {
            return command(readyAudit);
          }
          return command({
            nameWithOwner: "acme/widgets",
            url: "https://github.com/acme/widgets",
            isPrivate: true,
            defaultBranchRef: { name: "main" },
          });
        },
        fetch: async (input) => {
          expect(String(input)).toBe(
            "https://open-agents.example.com/api/background-agents/readiness",
          );
          return new Response(null, { status: 401 });
        },
      },
    );

    expect(result.ready).toBe(true);
    expect(result.checks.map((check) => [check.id, check.status])).toEqual([
      ["vercel_env", "ready"],
      ["readiness_route", "ready"],
      ["disposable_repo", "ready"],
      ["github_app_installation", "manual"],
    ]);
    expect(calls[0]).toEqual({
      command: "bun",
      args: [
        "run",
        "scripts/background-agent-vercel-env-audit.ts",
        "--environment",
        "production",
        "--json",
        "--require-allowlist",
        "--verify-values",
      ],
    });
  });

  test("does not accept a public readiness route as proof", async () => {
    const result = await runLiveProofPreflight(
      options({ baseUrl: "https://open-agents.example.com" }),
      {
        runCommand: () => command(readyAudit),
        fetch: async () => Response.json({ ready: true }),
      },
    );

    expect(result.ready).toBe(false);
    expect(
      result.checks.find((check) => check.id === "readiness_route"),
    ).toEqual(
      expect.objectContaining({
        status: "missing",
        missing: ["auth-protected readiness route"],
      }),
    );
  });

  test("includes preview branch in the env audit command", async () => {
    const result = await runLiveProofPreflight(
      options({
        environment: "preview",
        branch: "codex/background-agents-foundation",
      }),
      {
        runCommand: () =>
          command({
            ...readyAudit,
            environment: "preview",
            branch: "codex/background-agents-foundation",
          } satisfies EnvAuditResult),
        fetch: async () => new Response(null, { status: 401 }),
      },
    );

    expect(result.options).toEqual({
      environment: "preview",
      branch: "codex/background-agents-foundation",
      verifyValues: false,
    });
    expect(
      result.checks
        .find((check) => check.id === "vercel_env")
        ?.evidence.some(
          (value) => value === "branch=codex/background-agents-foundation",
        ),
    ).toBe(true);
  });
});
