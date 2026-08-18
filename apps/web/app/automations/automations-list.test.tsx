import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ListAutomationsResponse } from "@/lib/automations/types";
import { registerDomTestHooks, render, userClick, within } from "@/tests/dom";
import type { AutomationsList as AutomationsListComponent } from "./automations-list";

const refresh = mock(() => undefined);

mock.module("next/navigation", () => ({
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
    push: () => undefined,
    refresh,
    replace: () => undefined,
  }),
}));

const automationsListModule = import("./automations-list");

let AutomationsList: typeof AutomationsListComponent;

beforeAll(async () => {
  ({ AutomationsList } = await automationsListModule);
});

beforeEach(() => {
  refresh.mockClear();
});

registerDomTestHooks();

function response(
  overrides: Partial<ListAutomationsResponse> = {},
): ListAutomationsResponse {
  return {
    requestId: "request-1",
    automations: [],
    total: 0,
    sourceStatus: [
      {
        source: "background_agent",
        status: "ok",
        itemCount: 0,
        invalidItemCount: 0,
        errorKind: null,
      },
      {
        source: "agent_loop",
        status: "ok",
        itemCount: 0,
        invalidItemCount: 0,
        errorKind: null,
      },
    ],
    facets: { repositories: [], kinds: [], states: [] },
    ...overrides,
  };
}

describe("AutomationsList", () => {
  test("renders a unified item with a source-native edit link and canonical latest Run link", () => {
    const html = renderToStaticMarkup(
      <AutomationsList
        filters={{}}
        response={response({
          total: 1,
          automations: [
            {
              id: "qualified-id",
              source: "background_agent",
              sourceId: "agent-1",
              kind: "single_step",
              name: "PR reviewer",
              description: "Reviews pull requests",
              repository: { owner: "acme", name: "widgets" },
              nativeStatus: "enabled",
              operability: "active",
              configurationHealth: "invalid",
              configurationErrorKind: "automation_definition_invalid",
              observedRevision: {
                contractVersion: 1,
                sourceUpdatedAt: "2026-07-10T00:00:00.000Z",
              },
              stepCount: 1,
              triggers: {
                total: 1,
                enabled: 1,
                kinds: ["github.pull_request"],
                labels: ["On pull request"],
                nextRunAt: null,
              },
              verification: {
                configuredStepCount: 1,
                totalVerifiableSteps: 1,
              },
              output: { declaredSchemaCount: 0, publishingActionCount: 1 },
              latestRun: {
                id: "background_agent:run-1",
                source: "background_agent",
                sourceId: "run-1",
                nativeStatus: "succeeded",
                nativeSource: "github",
                title: "PR reviewer",
                state: "finished",
                outcome: "succeeded",
                health: "ok",
                attentionReasons: [],
                repository: { owner: "acme", name: "widgets" },
                detailUrl: "/runs/background-agent/run-1",
                timestamps: {
                  createdAt: "2026-07-10T00:00:00.000Z",
                  updatedAt: "2026-07-10T00:01:00.000Z",
                  startedAt: "2026-07-10T00:00:00.000Z",
                  finishedAt: "2026-07-10T00:01:00.000Z",
                },
                metadata: {},
                automation: {
                  source: "background_agent",
                  sourceId: "agent-1",
                },
                automationName: "PR reviewer",
                trigger: {
                  id: "trigger-1",
                  source: "github",
                  kind: "github.pull_request",
                },
                progress: {
                  currentStepId: null,
                  completedSteps: 1,
                  totalSteps: 1,
                },
                evidence: {
                  requestId: "request-1",
                  workflowRunId: "workflow-1",
                  sandboxName: null,
                  outputUrl: null,
                },
              },
              detailUrl: "/automations/background-agent/agent-1",
              editUrl: "/automations/background-agent/agent-1/edit",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-10T00:00:00.000Z",
            },
          ],
        })}
      />,
    );

    expect(html).toContain("Single step");
    expect(html).toContain("/automations/background-agent/agent-1/edit");
    expect(html).toContain("/automations/background-agent/agent-1");
    expect(html).toContain("/runs/background-agent/run-1");
    expect(html).not.toContain("/background-runs/run-1");
    expect(html).toContain('aria-label="Filter automations"');
    expect(html).toMatch(/>enabled</i);
    expect(html).toContain("Needs attention");
  });

  test("routes create actions through canonical Automation entries", () => {
    const globalHtml = renderToStaticMarkup(
      <AutomationsList filters={{}} response={response()} />,
    );
    expect(globalHtml).toContain('href="/automations/new"');
    expect(globalHtml).toContain('href="/automations/agent-loop/new"');
    expect(globalHtml).not.toContain('href="/settings/background-agents"');

    const repoHtml = renderToStaticMarkup(
      <AutomationsList
        filters={{ repository: { owner: "Acme Org", name: "widgets/api" } }}
        response={response()}
      />,
    );
    expect(repoHtml).toContain(
      'href="/automations/new?repoOwner=Acme+Org&amp;repoName=widgets%2Fapi"',
    );
    expect(repoHtml).toContain(
      'href="/automations/agent-loop/new?repoOwner=Acme+Org&amp;repoName=widgets%2Fapi"',
    );
  });

  test("shows healthy results and an explicit partial-source warning together", () => {
    const html = renderToStaticMarkup(
      <AutomationsList
        filters={{}}
        response={response({
          sourceStatus: [
            {
              source: "background_agent",
              status: "ok",
              itemCount: 0,
              invalidItemCount: 0,
              errorKind: null,
            },
            {
              source: "agent_loop",
              status: "failed",
              itemCount: 0,
              invalidItemCount: 0,
              errorKind: "source_unavailable",
            },
          ],
        })}
      />,
    );

    expect(html).toContain(
      "Multi-step automations are temporarily unavailable",
    );
    expect(html).toContain("No automations match these filters");
    expect(html).not.toContain("No automations configured");
  });

  test("distinguishes all-source failure from a genuine empty account", () => {
    const html = renderToStaticMarkup(
      <AutomationsList
        filters={{}}
        response={response({
          sourceStatus: [
            {
              source: "background_agent",
              status: "failed",
              itemCount: 0,
              invalidItemCount: 0,
              errorKind: "source_unavailable",
            },
            {
              source: "agent_loop",
              status: "failed",
              itemCount: 0,
              invalidItemCount: 0,
              errorKind: "source_unavailable",
            },
          ],
        })}
      />,
    );

    expect(html).toContain("Automations could not be loaded");
    expect(html).not.toContain("No automations configured");
  });

  test("does not link to the multi-step creator when loops are disabled", () => {
    const html = renderToStaticMarkup(
      <AutomationsList
        filters={{}}
        response={response({
          sourceStatus: [
            {
              source: "background_agent",
              status: "ok",
              itemCount: 0,
              invalidItemCount: 0,
              errorKind: null,
            },
            {
              source: "agent_loop",
              status: "disabled",
              itemCount: 0,
              invalidItemCount: 0,
              errorKind: "feature_disabled",
            },
          ],
        })}
      />,
    );

    expect(html).toContain("Multi-step unavailable");
    expect(html).not.toContain('href="/loops/new"');
    expect(html).not.toContain('href="/automations/agent-loop/new"');
    expect(html).toContain('href="/automations/new"');
    expect(html).toContain("No automations configured");
    expect(html).toContain("Create a single-step automation");
    expect(html).not.toContain("No automations match these filters");
    expect(html).not.toContain("retry after");
  });

  test("allUnavailable state renders a Retry this page button that re-runs the list fetch", async () => {
    const { baseElement } = render(
      <AutomationsList
        filters={{}}
        response={response({
          sourceStatus: [
            {
              source: "background_agent",
              status: "failed",
              itemCount: 0,
              invalidItemCount: 0,
              errorKind: "source_unavailable",
            },
            {
              source: "agent_loop",
              status: "failed",
              itemCount: 0,
              invalidItemCount: 0,
              errorKind: "source_unavailable",
            },
          ],
        })}
      />,
    );

    const retry = within(baseElement).getByRole("button", {
      name: "Retry this page",
    });
    expect(retry).not.toBeNull();

    await userClick(retry);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
