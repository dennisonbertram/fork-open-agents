import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let sessionUserId: string | null = "user-1";
let repoAgents: Array<{
  id: string;
  name: string;
  status: "enabled" | "disabled";
  instructions: string;
  triggers: Array<{
    id: string;
    kind: string;
  }>;
}> = [];
let repoRuns: Array<{
  id: string;
  triggerKind: string;
  status: string;
  payloadSummary: {
    title?: string;
    message?: string;
  };
  externalId: string;
  sha: string | null;
  ref: string | null;
  branch: string | null;
  createdAt: Date;
}> = [];

const redirect = mock((_path: string) => {
  throw new Error("redirect");
});
const push = mock((_url: string) => undefined);
const listRepoBackgroundAgents = mock(async () => repoAgents);
const listBackgroundAgentRuns = mock(async () => repoRuns);

mock.module("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push }),
}));

// swr is used by RepoAgentsDashboard (client component imported by page)
mock.module("swr", () => ({
  default: () => ({
    data: undefined,
    error: null,
    isLoading: false,
    mutate: async () => undefined,
  }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId
      ? {
          user: {
            id: sessionUserId,
          },
        }
      : null,
}));

mock.module("@/lib/background-agents/store", () => ({
  listRepoBackgroundAgents,
  listBackgroundAgentRuns,
}));

const pageModulePromise = import("./page");

describe("RepoAgentsPage", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    repoAgents = [];
    repoRuns = [];
    redirect.mockClear();
    listRepoBackgroundAgents.mockClear();
    listBackgroundAgentRuns.mockClear();
  });

  test("renders configured agents and run history for a repository", async () => {
    repoAgents = [
      {
        id: "agent-1",
        name: "Deploy smoke",
        status: "enabled",
        instructions: "Run smoke checks after deployments.",
        triggers: [
          {
            id: "trigger-1",
            kind: "github.deployment_status",
          },
        ],
      },
    ];
    repoRuns = [
      {
        id: "run-1",
        triggerKind: "github.deployment_status",
        status: "succeeded",
        payloadSummary: {
          title: "Production deployment succeeded",
        },
        externalId: "delivery-1",
        sha: "abc123",
        ref: null,
        branch: null,
        createdAt: new Date("2026-05-27T12:00:00.000Z"),
      },
    ];
    const { default: RepoAgentsPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoAgentsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(listRepoBackgroundAgents).toHaveBeenCalledWith({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
    });
    expect(listBackgroundAgentRuns).toHaveBeenCalledWith({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      limit: 50,
    });
    expect(html).toContain("Background agents");
    expect(html).toContain("acme/widgets");
    expect(html).toContain("Deploy smoke");
    expect(html).toContain("Run smoke checks after deployments.");
    expect(html).toContain("github.deployment_status");
    expect(html).toContain("Production deployment succeeded");
    expect(html).toContain("abc123");
    expect(html).toContain("/background-runs/run-1");
    expect(html).toContain("/settings/background-agents");
  });

  test("renders repo-scoped empty states", async () => {
    const { default: RepoAgentsPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoAgentsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("No agents configured for this repository.");
    expect(html).toContain("No runs recorded for this repository.");
  });
});
