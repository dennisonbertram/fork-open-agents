import { describe, expect, test } from "bun:test";
import type { Octokit } from "@octokit/rest";
import { MAX_PROXIED_JOB_LOG_BYTES, proxyJobLogs } from "./logs";

function createOctokitWithLog(data: string): Octokit {
  return {
    rest: {
      actions: {
        downloadJobLogsForWorkflowRun: async () => ({ data }),
      },
    },
  } as unknown as Octokit;
}

describe("proxyJobLogs", () => {
  test("caps proxied logs to a bounded utf-8 byte window", async () => {
    const logs = await proxyJobLogs(
      createOctokitWithLog("a".repeat(MAX_PROXIED_JOB_LOG_BYTES + 10)),
      "acme",
      "widgets",
      987,
    );

    expect(logs.bytes).toBe(MAX_PROXIED_JOB_LOG_BYTES);
    expect(logs.originalBytes).toBe(MAX_PROXIED_JOB_LOG_BYTES + 10);
    expect(logs.truncated).toBe(true);
    expect(logs.text).toHaveLength(MAX_PROXIED_JOB_LOG_BYTES);
  });

  test("does not split multi-byte characters while truncating", async () => {
    const logs = await proxyJobLogs(
      createOctokitWithLog("é".repeat(MAX_PROXIED_JOB_LOG_BYTES)),
      "acme",
      "widgets",
      987,
    );

    expect(logs.bytes).toBeLessThanOrEqual(MAX_PROXIED_JOB_LOG_BYTES);
    expect(logs.text.endsWith("\uFFFD")).toBe(false);
    expect(logs.truncated).toBe(true);
  });
});
