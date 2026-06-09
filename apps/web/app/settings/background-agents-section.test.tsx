import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildAgentPayload,
  buildFormFromAgent,
  supportedOutputModes,
} from "./background-agents-form";

type AgentListData = {
  agents: Array<{
    id: string;
    name: string;
    description: string | null;
    status: "enabled" | "disabled";
    repoOwner: string;
    repoName: string;
    instructions: string;
    outputMode: "comment" | "ready_pr" | "issue" | "notification" | "none";
    checkCommand: string | null;
    triggers: Array<{
      id: string;
      name: string;
      kind:
        | "github.pull_request"
        | "github.deployment_status"
        | "github.issue"
        | "schedule.cron"
        | "webhook.error";
      status: "enabled" | "disabled";
      conditions?: {
        actions?: string[];
        branches?: string[];
        labels?: string[];
        environments?: string[];
        severities?: string[];
      };
      schedule: string | null;
      webhookPublicId: string | null;
    }>;
  }>;
};

type RunListData = {
  runs: Array<{
    id: string;
    status: string;
    source: string;
    triggerKind: string;
    externalId: string;
    repoOwner: string;
    repoName: string;
    ref: string | null;
    sha: string | null;
    branch: string | null;
    prNumber: number | null;
    issueNumber: number | null;
    outputKind: string | null;
    outputUrl: string | null;
    errorKind: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
};

type ReadinessData = {
  enabled: boolean;
  ready: boolean;
  missing: string[];
  checks: Array<{
    id: string;
    label: string;
    status: "ready" | "missing" | "disabled";
    detail: string;
    missing: string[];
  }>;
};

type SwrState<T> = {
  data?: T;
  error?: Error | null;
  isLoading?: boolean;
};

let agentsSwrState: SwrState<AgentListData> = {};
let runsSwrState: SwrState<RunListData> = {};
let readinessSwrState: SwrState<ReadinessData> = {};
const push = mock((_url: string) => undefined);
const mutate = mock(async () => undefined);

mock.module("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

mock.module("swr", () => ({
  default: (key: string) => {
    const state = key.startsWith("/api/background-agents/readiness")
      ? readinessSwrState
      : key.startsWith("/api/background-agent-runs")
        ? runsSwrState
        : agentsSwrState;
    return {
      data: state.data,
      error: state.error ?? null,
      isLoading: state.isLoading ?? false,
      mutate,
    };
  },
}));

const componentModulePromise = import("./background-agents-section");

describe("BackgroundAgentsSection", () => {
  beforeEach(() => {
    agentsSwrState = {};
    runsSwrState = {};
    readinessSwrState = {};
    push.mockClear();
    mutate.mockClear();
  });

  test("renders a loading state instead of an empty state while agents load", async () => {
    agentsSwrState = {
      isLoading: true,
    };
    runsSwrState = {
      isLoading: true,
    };
    readinessSwrState = {
      isLoading: true,
    };
    const { BackgroundAgentsSection } = await componentModulePromise;

    const html = renderToStaticMarkup(<BackgroundAgentsSection />);

    expect(html).toContain("Readiness");
    expect(html).toContain("Loading background agent readiness.");
    expect(html).toContain("Create agent");
    expect(html).toContain("Conditions");
    expect(html).toContain("Agents");
    expect(html).toContain("Loading background agents.");
    expect(html).toContain("Run history");
    expect(html).toContain("Loading background runs.");
    expect(html).not.toContain("No background agents yet.");
  });

  test("renders empty and error states for the agent list", async () => {
    const { BackgroundAgentsSection } = await componentModulePromise;

    agentsSwrState = {
      data: { agents: [] },
    };
    const emptyHtml = renderToStaticMarkup(<BackgroundAgentsSection />);
    expect(emptyHtml).toContain("No background agents yet.");

    agentsSwrState = {
      error: new Error("load failed"),
    };
    const errorHtml = renderToStaticMarkup(<BackgroundAgentsSection />);
    expect(errorHtml).toContain("Failed to load background agents.");
  });

  test("renders readiness diagnostics without secret values", async () => {
    const { BackgroundAgentsSection } = await componentModulePromise;

    // enabled=true, ready=false → action-needed verdict with missing-count subtext
    readinessSwrState = {
      data: {
        enabled: true,
        ready: false,
        missing: ["BACKGROUND_AGENTS_ENABLED", "GITHUB_APP_PRIVATE_KEY"],
        checks: [
          {
            id: "feature_flag",
            label: "Feature flag",
            status: "disabled",
            detail: "BACKGROUND_AGENTS_ENABLED gates trigger dispatch.",
            missing: ["BACKGROUND_AGENTS_ENABLED"],
          },
          {
            id: "github_app",
            label: "GitHub App",
            status: "missing",
            detail:
              "Required for webhook trust and repo-scoped installation access.",
            missing: ["GITHUB_APP_PRIVATE_KEY"],
          },
        ],
      },
    };
    const missingHtml = renderToStaticMarkup(<BackgroundAgentsSection />);
    expect(missingHtml).toContain("Readiness");
    // Plain-language subtext replaces the old raw count string
    expect(missingHtml).toContain("2 prerequisites need attention.");
    // Raw env-var names are behind the collapsed Operator details disclosure
    // and must NOT appear in the headline; the "Operator details" affordance is visible
    expect(missingHtml).toContain("Operator details");
    expect(missingHtml).not.toContain("secret-value");

    // enabled=false → unavailable verdict with admin guidance
    readinessSwrState = {
      data: {
        enabled: false,
        ready: false,
        missing: ["BACKGROUND_AGENTS_ENABLED"],
        checks: [
          {
            id: "feature_flag",
            label: "Feature flag",
            status: "disabled",
            detail: "BACKGROUND_AGENTS_ENABLED gates trigger dispatch.",
            missing: ["BACKGROUND_AGENTS_ENABLED"],
          },
        ],
      },
    };
    const unavailableHtml = renderToStaticMarkup(<BackgroundAgentsSection />);
    expect(unavailableHtml).toContain("Background agents aren");
    expect(unavailableHtml).toContain("workspace administrator");

    readinessSwrState = {
      data: {
        enabled: true,
        ready: true,
        missing: [],
        checks: [
          {
            id: "feature_flag",
            label: "Feature flag",
            status: "ready",
            detail: "BACKGROUND_AGENTS_ENABLED gates trigger dispatch.",
            missing: [],
          },
        ],
      },
    };
    const readyHtml = renderToStaticMarkup(<BackgroundAgentsSection />);
    expect(readyHtml).toContain("Hosted prerequisites are configured.");

    readinessSwrState = {
      error: new Error("load failed"),
    };
    const errorHtml = renderToStaticMarkup(<BackgroundAgentsSection />);
    expect(errorHtml).toContain("Failed to load background agent readiness.");
  });

  test("renders empty, error, and configured states for run history", async () => {
    const { BackgroundAgentsSection } = await componentModulePromise;

    agentsSwrState = {
      data: { agents: [] },
    };
    runsSwrState = {
      data: { runs: [] },
    };
    const emptyHtml = renderToStaticMarkup(<BackgroundAgentsSection />);
    expect(emptyHtml).toContain("No background runs yet.");

    runsSwrState = {
      error: new Error("load failed"),
    };
    const errorHtml = renderToStaticMarkup(<BackgroundAgentsSection />);
    expect(errorHtml).toContain("Failed to load background runs.");

    runsSwrState = {
      data: {
        runs: [
          {
            id: "run-1",
            status: "succeeded",
            source: "manual",
            triggerKind: "github.pull_request",
            externalId: "manual-test",
            repoOwner: "acme",
            repoName: "widgets",
            ref: "refs/heads/main",
            sha: null,
            branch: "main",
            prNumber: 42,
            issueNumber: null,
            outputKind: "ready_pr",
            outputUrl: "https://github.com/acme/widgets/pull/42",
            errorKind: null,
            createdAt: "2026-05-27T12:00:00.000Z",
            startedAt: "2026-05-27T12:00:01.000Z",
            finishedAt: "2026-05-27T12:00:10.000Z",
          },
        ],
      },
    };
    const configuredHtml = renderToStaticMarkup(<BackgroundAgentsSection />);
    // Trigger kind is now humanized in run history: "Pull request" not raw "github.pull_request"
    expect(configuredHtml).toContain("Pull request");
    expect(configuredHtml).not.toContain("github.pull_request");
    expect(configuredHtml).toContain("acme/widgets");
    expect(configuredHtml).toContain("PR #42");
    expect(configuredHtml).toContain("/background-runs/run-1");
    expect(configuredHtml).toContain("https://github.com/acme/widgets/pull/42");
  });

  test("renders configure, future tools, test, and repo inspection paths", async () => {
    agentsSwrState = {
      data: {
        agents: [
          {
            id: "agent-1",
            name: "Deploy smoke",
            description: null,
            status: "enabled",
            repoOwner: "acme",
            repoName: "widgets",
            instructions: "Run deployment smoke checks.",
            outputMode: "ready_pr",
            checkCommand: "bun --bun run ci",
            triggers: [
              {
                id: "trigger-1",
                name: "Pull request",
                kind: "github.pull_request",
                status: "enabled",
                conditions: {
                  actions: ["opened"],
                  branches: ["main"],
                },
                schedule: null,
                webhookPublicId: null,
              },
              {
                id: "trigger-2",
                name: "Error webhook",
                kind: "webhook.error",
                status: "enabled",
                schedule: null,
                webhookPublicId: "wh_123",
              },
            ],
          },
        ],
      },
    };
    const { BackgroundAgentsSection } = await componentModulePromise;

    const html = renderToStaticMarkup(<BackgroundAgentsSection />);

    expect(html).toContain("Deploy smoke");
    expect(html).toContain("acme/widgets");
    expect(html).toContain("Pull request");
    expect(html).toContain("Error webhook");
    expect(html).toContain("Tool providers coming later");
    expect(html).toContain("Composio is planned for v1.5");
    expect(supportedOutputModes).toEqual(["none", "ready_pr"]);
    expect(html).toContain("Edit");
    expect(html).toContain("Test");
    expect(html).toContain("/repos/acme/widgets/agents");
  });

  test("BT-001: renders webhook URL for webhook.error trigger with webhookPublicId", async () => {
    agentsSwrState = {
      data: {
        agents: [
          {
            id: "agent-wh",
            name: "Error watcher",
            description: null,
            status: "enabled",
            repoOwner: "acme",
            repoName: "api",
            instructions: "Watch for errors.",
            outputMode: "none",
            checkCommand: null,
            triggers: [
              {
                id: "trigger-wh",
                name: "Error webhook",
                kind: "webhook.error",
                status: "enabled",
                schedule: null,
                webhookPublicId: "wh_abc123",
              },
            ],
          },
        ],
      },
    };
    const { BackgroundAgentsSection } = await componentModulePromise;

    const html = renderToStaticMarkup(<BackgroundAgentsSection />);

    // The webhook URL should be rendered inside the trigger pill area
    expect(html).toContain("/api/background-agents/webhook/wh_abc123");
    // It should have a copy button for the URL
    expect(html).toContain("Copy webhook URL");
  });

  test("BT-002: delete button is rendered in the agent action row", async () => {
    agentsSwrState = {
      data: {
        agents: [
          {
            id: "agent-del",
            name: "To be deleted",
            description: null,
            status: "enabled",
            repoOwner: "acme",
            repoName: "widgets",
            instructions: "Some instructions.",
            outputMode: "none",
            checkCommand: null,
            triggers: [
              {
                id: "trigger-del",
                name: "Pull request",
                kind: "github.pull_request",
                status: "enabled",
                schedule: null,
                webhookPublicId: null,
              },
            ],
          },
        ],
      },
    };
    const { BackgroundAgentsSection } = await componentModulePromise;

    const html = renderToStaticMarkup(<BackgroundAgentsSection />);

    // A destructive Delete button must be present in the agent action row
    expect(html).toContain("Delete");
    // The delete button should have an aria-label for accessibility
    expect(html).toContain("Delete agent");
  });

  test("REG-001: webhook URL not shown when webhookPublicId is null (regression guard)", async () => {
    agentsSwrState = {
      data: {
        agents: [
          {
            id: "agent-no-wh",
            name: "No webhook",
            description: null,
            status: "enabled",
            repoOwner: "acme",
            repoName: "api",
            instructions: "Watch for PRs.",
            outputMode: "none",
            checkCommand: null,
            triggers: [
              {
                id: "trigger-no-wh",
                name: "Error webhook",
                kind: "webhook.error",
                status: "enabled",
                schedule: null,
                webhookPublicId: null,
              },
            ],
          },
        ],
      },
    };
    const { BackgroundAgentsSection } = await componentModulePromise;

    const html = renderToStaticMarkup(<BackgroundAgentsSection />);

    // Should NOT render any webhook path when webhookPublicId is null
    expect(html).not.toContain("/api/background-agents/webhook/");
    // Should NOT render the copy webhook URL button
    expect(html).not.toContain("Copy webhook URL");
  });

  test("REG-002: delete button absent when agents list is empty (regression guard)", async () => {
    agentsSwrState = {
      data: { agents: [] },
    };
    const { BackgroundAgentsSection } = await componentModulePromise;

    const html = renderToStaticMarkup(<BackgroundAgentsSection />);

    // Delete button should not appear when there are no agents
    expect(html).not.toContain("Delete agent");
    expect(html).toContain("No background agents yet.");
  });

  test("builds edit form state and update payloads for existing agents", async () => {
    // Realistic stored deployment agent: status is in conditions.actions (not
    // conditions.severities) because the normalizer sets event.action = deployment state.
    const form = buildFormFromAgent({
      id: "agent-1",
      name: "Deploy smoke",
      description: null,
      status: "disabled",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Run deployment smoke checks.",
      outputMode: "ready_pr",
      checkCommand: "bun --bun run ci",
      triggers: [
        {
          id: "trigger-1",
          name: "Deployment",
          kind: "github.deployment_status",
          status: "enabled",
          conditions: {
            actions: ["success"],
            environments: ["production"],
          },
          schedule: null,
          webhookPublicId: null,
        },
      ],
    });

    // buildFormFromAgent restores conditions.actions → conditionSeverities for
    // deployment triggers, and leaves conditionActions empty.
    expect(form).toMatchObject({
      name: "Deploy smoke",
      enabled: false,
      triggerKind: "github.deployment_status",
      conditionActions: "",
      conditionEnvironments: "production",
      conditionSeverities: "success",
      outputMode: "ready_pr",
    });

    // Simulate the user updating the status filter in the editor
    const payload = buildAgentPayload({
      ...form,
      enabled: true,
      conditionSeverities: "success, failure",
    });

    expect(payload.status).toBe("enabled");
    expect(payload.permissions.github.contents).toBe("write");
    expect(payload.permissions.github.pullRequests).toBe("write");
    expect(payload.triggers[0]).toMatchObject({
      kind: "github.deployment_status",
      conditions: {
        // conditionSeverities routes to conditions.actions for deployment
        actions: ["success", "failure"],
        environments: ["production"],
      },
    });
  });
});
