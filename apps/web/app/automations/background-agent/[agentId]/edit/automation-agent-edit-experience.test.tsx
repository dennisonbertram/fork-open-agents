import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";

let readinessReady = false;
let swrKey: string | null = null;

mock.module("swr", () => ({
  default: (key: string) => {
    swrKey = key;
    return {
      data: {
        enabled: true,
        ready: readinessReady,
        missing: readinessReady ? [] : ["BACKGROUND_AGENTS_ALLOWED_REPOS"],
        checks: [],
        repoAccess: {
          ready: readinessReady,
          repoOwner: "acme",
          repoName: "widgets",
          requiredUserPermission: "write",
          reason: readinessReady ? null : "app_no_access",
          message: readinessReady ? "Ready" : "Repository access is missing",
          installationId: null,
          repositoryId: null,
          defaultBranch: null,
        },
      },
      isLoading: false,
      mutate: async () => undefined,
    };
  },
}));
mock.module("@/components/ui/readiness-verdict", () => ({
  ReadinessVerdict: ({ headline }: { headline: string }) => (
    <div data-testid="readiness-verdict">{headline}</div>
  ),
}));
mock.module(
  "@/app/repos/[owner]/[repo]/agents/[agentId]/edit/agent-edit-form",
  () => ({
    AgentEditForm: (props: {
      surface?: string;
      readinessReady?: boolean;
      owner: string;
      repo: string;
    }) => (
      <div
        data-testid="agent-edit-form"
        data-surface={props.surface}
        data-readiness-ready={String(props.readinessReady)}
        data-repository={`${props.owner}/${props.repo}`}
      />
    ),
  }),
);

const modulePromise = import("./automation-agent-edit-experience");

const agent = {
  id: "agent-1",
  status: "disabled",
  repoOwner: "acme",
  repoName: "widgets",
} as unknown as BackgroundAgentWithTriggers;

describe("AutomationAgentEditExperience", () => {
  beforeEach(() => {
    readinessReady = false;
    swrKey = null;
  });

  test("loads write readiness for the owned repository and fails enablement closed", async () => {
    const { AutomationAgentEditExperience } = await modulePromise;
    const html = renderToStaticMarkup(
      <AutomationAgentEditExperience agent={agent} />,
    );

    expect(swrKey).toBe(
      "/api/background-agents/readiness?repoOwner=acme&repoName=widgets&permission=write",
    );
    expect(html).toContain("Automation needs a bit more setup.");
    expect(html).toContain('data-surface="automation"');
    expect(html).toContain('data-readiness-ready="false"');
    expect(html).toContain('data-repository="acme/widgets"');
  });

  test("passes readiness only after deployment and repository checks are ready", async () => {
    readinessReady = true;
    const { AutomationAgentEditExperience } = await modulePromise;
    const html = renderToStaticMarkup(
      <AutomationAgentEditExperience agent={agent} />,
    );

    expect(html).toContain("Automation prerequisites are ready.");
    expect(html).toContain('data-readiness-ready="true"');
  });
});
