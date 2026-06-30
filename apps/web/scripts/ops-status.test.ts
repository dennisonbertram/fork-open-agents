import { describe, expect, test } from "bun:test";
import {
  formatOpsStatus,
  parseGhRuns,
  parseVercelInspect,
  parseVercelLogs,
  type OpsStatusSnapshot,
} from "./ops-status";

describe("ops status", () => {
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
});
