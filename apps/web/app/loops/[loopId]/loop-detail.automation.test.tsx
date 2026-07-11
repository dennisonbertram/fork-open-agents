import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  AgentLoopsReadinessResponse,
  GetAgentLoopResponse,
} from "@/app/api/agent-loops/types";

let readiness: AgentLoopsReadinessResponse | undefined;
let readinessError: Error | undefined;

mock.module("swr", () => ({
  default: <T,>(
    key: string | null,
    _fetcher?: unknown,
    options?: { fallbackData?: T },
  ) => {
    if (key?.includes("/readiness?")) {
      return {
        data: readiness as T | undefined,
        error: readinessError,
        mutate: async () => undefined,
      };
    }
    if (key?.endsWith("/runs")) {
      return {
        data: {
          runs: [
            {
              id: "run-1",
              loopId: "loop-1",
              status: "completed",
              source: "manual",
              failedStepCount: 0,
              startedAt: new Date("2026-07-11T10:00:00.000Z"),
              finishedAt: new Date("2026-07-11T10:01:00.000Z"),
              createdAt: new Date("2026-07-11T10:00:00.000Z"),
            },
          ],
        } as T,
        mutate: async () => undefined,
      };
    }
    if (key?.endsWith("/triggers")) {
      return { data: { triggers: [] } as T, mutate: async () => undefined };
    }
    return {
      data: options?.fallbackData,
      mutate: async () => undefined,
    };
  },
}));
mock.module("./use-loop-run-now", () => ({
  useLoopRunNow: () => ({ runNow: async () => undefined, runningNow: false }),
}));

const detailModulePromise = import("./loop-detail");

function loopData(): GetAgentLoopResponse {
  return {
    loop: {
      id: "loop-1",
      userId: "user-1",
      name: "Release safely",
      description: "Deploy after verification.",
      repoOwner: "acme",
      repoName: "shop",
      status: "active",
      definition: {
        nodes: [
          {
            id: "start",
            kind: "start",
            label: "Start",
            position: { x: 0, y: 0 },
          },
          {
            id: "end",
            kind: "end",
            label: "End",
            position: { x: 200, y: 0 },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "start",
            target: "end",
            when: "always",
          },
        ],
      },
      permissions: {},
      guardrails: null,
      watchdogEnabled: false,
      watchdogInstructions: null,
      watchdogRetryBudget: 2,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-11T00:00:00.000Z"),
    },
    triggers: [],
  };
}

describe("LoopDetail canonical Automation presentation", () => {
  beforeEach(() => {
    readinessError = undefined;
    readiness = {
      enabled: true,
      checks: [
        {
          id: "feature_flag",
          label: "Feature flag",
          status: "ready",
          detail: "Ready",
          missing: [],
        },
        {
          id: "repo_allowlist",
          label: "Repository allowlist",
          status: "ready",
          detail: "Ready",
          missing: [],
        },
        {
          id: "repo_access",
          label: "This repository",
          status: "ready",
          detail: "Ready",
          missing: [],
        },
      ],
    };
  });

  test("keeps definition, lifecycle, readiness, triggers, and run evidence distinct", async () => {
    const { LoopDetail } = await detailModulePromise;
    const html = renderToStaticMarkup(
      <LoopDetail
        loopId="loop-1"
        initialLoopData={loopData()}
        surface="automation"
      />,
    );

    expect(html).toContain("Multi-step Automation");
    expect(html).toContain("Configuration validity");
    expect(html).toContain("Valid definition");
    expect(html).toContain("Lifecycle status");
    expect(html).toContain("Execution readiness");
    expect(html).toContain("Ready for manual execution");
    expect(html).toContain("Trigger coverage");
    expect(html).toContain("No triggers configured");
    expect(html).toContain(
      "Run now starts real unattended work with the configured repository permissions.",
    );
    expect(html).toContain('href="/automations"');
    expect(html).toContain('href="/automations/agent-loop/loop-1/edit"');
    expect(html).toContain('href="/runs/loop/run-1"');
    expect(html).not.toContain('href="/loops/loop-1/runs/run-1"');
  });

  test("fails execution readiness closed when the repository-scoped response is unavailable", async () => {
    readiness = undefined;
    readinessError = new Error("unavailable");
    const { LoopDetail } = await detailModulePromise;
    const html = renderToStaticMarkup(
      <LoopDetail
        loopId="loop-1"
        initialLoopData={loopData()}
        surface="automation"
      />,
    );

    expect(html).toContain("Execution readiness unknown");
    expect(html).toContain("Readiness could not be verified");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*<svg[\s\S]*Run now/);
  });

  test("legacy default keeps native links and copy", async () => {
    const { LoopDetail } = await detailModulePromise;
    const html = renderToStaticMarkup(
      <LoopDetail loopId="loop-1" initialLoopData={loopData()} />,
    );
    expect(html).toContain('href="/loops/loop-1/builder"');
    expect(html).toContain('href="/loops/loop-1/runs/run-1"');
    expect(html).not.toContain("configured repository permissions");
  });
});
