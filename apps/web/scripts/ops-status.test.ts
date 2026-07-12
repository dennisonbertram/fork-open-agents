import { describe, expect, test } from "bun:test";
import {
  buildVercelInspectArgs,
  buildVercelLogsArgs,
  formatOpsStatus,
  isOpsStatusHealthy,
  parseGhRuns,
  parseLatestProductionDeploymentSha,
  parseVercelInspect,
  parseVercelLogs,
  resolveVercelTarget,
  type OpsStatusSnapshot,
} from "./ops-status";

describe("ops status", () => {
  test("resolves an explicit Vercel target before environment and linked metadata", () => {
    expect(
      resolveVercelTarget({
        explicit: { scope: "explicit-scope", project: "explicit-project" },
        env: {
          VERCEL_ORG_ID: "env-scope",
          VERCEL_PROJECT_ID: "env-project",
        },
        linkedProject: { orgId: "linked-scope", projectId: "linked-project" },
      }),
    ).toEqual({
      status: "resolved",
      scope: "explicit-scope",
      project: "explicit-project",
      source: "explicit",
    });
  });

  test("does not mix a partial explicit target with environment metadata", () => {
    expect(
      resolveVercelTarget({
        explicit: { scope: "explicit-scope" },
        env: {
          VERCEL_ORG_ID: "env-scope",
          VERCEL_PROJECT_ID: "env-project",
        },
      }),
    ).toEqual({
      status: "blocked",
      sourceGap: "Both --scope and --project are required together.",
    });
  });

  test("falls back from paired environment metadata to linked metadata", () => {
    expect(
      resolveVercelTarget({
        env: {
          VERCEL_ORG_ID: "env-scope",
          VERCEL_PROJECT_ID: "env-project",
        },
        linkedProject: { orgId: "linked-scope", projectId: "linked-project" },
      }),
    ).toMatchObject({
      status: "resolved",
      scope: "env-scope",
      project: "env-project",
      source: "environment",
    });
    expect(
      resolveVercelTarget({
        env: {},
        linkedProject: { orgId: "linked-scope", projectId: "linked-project" },
      }),
    ).toMatchObject({
      status: "resolved",
      scope: "linked-scope",
      project: "linked-project",
      source: "linked-project",
    });
  });

  test("does not mix partial environment metadata with a linked project", () => {
    expect(
      resolveVercelTarget({
        env: { VERCEL_ORG_ID: "env-scope" },
        linkedProject: { orgId: "linked-scope", projectId: "linked-project" },
      }),
    ).toEqual({
      status: "blocked",
      sourceGap: "VERCEL_ORG_ID and VERCEL_PROJECT_ID are required together.",
    });
  });

  test("rejects blank target values instead of invoking an ambient scope", () => {
    expect(
      resolveVercelTarget({
        explicit: { scope: "   ", project: "project" },
      }),
    ).toEqual({
      status: "blocked",
      sourceGap: "Both --scope and --project are required together.",
    });
  });

  test("builds inspect and logs commands with the same resolved target", () => {
    const target = { scope: "team_123", project: "prj_123" };
    expect(buildVercelInspectArgs("https://example.com", target)).toEqual([
      "inspect",
      "https://example.com",
      "--scope",
      "team_123",
      "--json",
    ]);
    expect(buildVercelLogsArgs("30m", target)).toEqual([
      "logs",
      "--scope",
      "team_123",
      "--project",
      "prj_123",
      "--environment",
      "production",
      "--status-code",
      "500,502,503,504",
      "--since",
      "30m",
    ]);
  });

  test("strict health rejects every blocked or non-healthy proof source", () => {
    const healthy: OpsStatusSnapshot = {
      requestedAt: "2026-06-30T00:00:00.000Z",
      environment: "production",
      productionUrl: "https://example.com",
      deployment: { status: "healthy" },
      publicSmoke: { status: "healthy", summary: "ok" },
      logs: { status: "healthy", window: "30m", errorCount: 0, samples: [] },
      github: { status: "healthy", openPrBlockers: [] },
      nextAction: "Run the canary.",
    };
    expect(isOpsStatusHealthy(healthy)).toBe(true);
    expect(
      isOpsStatusHealthy({
        ...healthy,
        deployment: { status: "blocked", sourceGap: "missing access" },
      }),
    ).toBe(false);
    expect(
      isOpsStatusHealthy({
        ...healthy,
        logs: {
          status: "blocked",
          window: "30m",
          errorCount: 0,
          samples: [],
          sourceGap: "missing access",
        },
      }),
    ).toBe(false);
    expect(
      isOpsStatusHealthy({
        ...healthy,
        github: {
          status: "blocked",
          openPrBlockers: [],
          sourceGap: "missing access",
        },
      }),
    ).toBe(false);
  });

  test("parses deployment metadata from vercel inspect json", () => {
    expect(
      parseVercelInspect(
        JSON.stringify({
          id: "dpl_123",
          url: "open-agents.example",
          meta: { githubCommitSha: "abc123" },
        }),
      ),
    ).toEqual({
      id: "dpl_123",
      url: "open-agents.example",
      commitSha: "abc123",
    });
  });

  test("redacts log samples and counts recent errors", () => {
    const parsed = parseVercelLogs(
      "500 boom\nGITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz\n",
    );
    expect(parsed.errorCount).toBe(2);
    expect(parsed.samples[1]).toBe("[redacted]");
  });

  test("formats explicit no-error state and source gaps", () => {
    const snapshot: OpsStatusSnapshot = {
      requestedAt: "2026-06-30T00:00:00.000Z",
      environment: "production",
      productionUrl: "https://example.com",
      deployment: { status: "blocked", sourceGap: "vercel_access_missing" },
      publicSmoke: { status: "healthy", summary: "ok" },
      logs: { status: "healthy", window: "30m", errorCount: 0, samples: [] },
      github: {
        status: "healthy",
        openPrBlockers: [],
        latestProductionSmoke: "Production Smoke completed/success",
      },
      nextAction: "Run the canary.",
    };
    const output = formatOpsStatus(snapshot);
    expect(output).toContain("No recent 5xx/error logs found.");
    expect(output).toContain("vercel_access_missing");
  });

  test("parses latest production smoke run", () => {
    expect(
      parseGhRuns(
        JSON.stringify([
          {
            status: "completed",
            conclusion: "skipped",
            url: "https://github.com/skipped",
          },
          {
            status: "completed",
            conclusion: "success",
            url: "https://github.com/run",
          },
        ]),
      ),
    ).toContain("completed/success");
  });

  test("parses the latest GitHub production deployment SHA as inspect fallback", () => {
    expect(
      parseLatestProductionDeploymentSha(
        JSON.stringify([{ sha: "5f5b6a91", environment: "Production" }]),
      ),
    ).toBe("5f5b6a91");
  });
});
