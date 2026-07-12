import { describe, expect, mock, test } from "bun:test";
import {
  buildAgentPayload,
  defaultForm,
} from "@/lib/background-agents/agent-spec";
import { submitNewAgent } from "@/app/repos/[owner]/[repo]/agents/new/create-agent-request";
import { submitAgentUpdate } from "@/app/repos/[owner]/[repo]/agents/new/update-agent-request";

function response(agentId: string): Response {
  return Response.json({ agent: { id: agentId } });
}

describe("single-step Automation write compatibility", () => {
  test("create and update send the exact legacy payload bytes to the existing endpoints", async () => {
    const payload = buildAgentPayload({
      ...defaultForm,
      name: "PR reviewer",
      repoOwner: "Acme Org",
      repoName: "widgets",
      conditionActions: "opened, synchronize",
      conditionBranches: "main",
      instructions: "Review the diff and open a pull request when needed.",
      checkCommand: "bun --bun run ci",
      enabled: false,
      composioToolkitSlugs: ["linear"],
      githubActions: {
        open_pull_request: true,
        comment_on_pr_or_issue: true,
      },
      writeScope: { mode: "this_repo" },
      requireCiGreenForMerge: true,
      modelId: "gateway/model",
    });
    const expectedBytes = JSON.stringify({
      name: "PR reviewer",
      repoOwner: "Acme Org",
      repoName: "widgets",
      status: "disabled",
      instructions: "Review the diff and open a pull request when needed.",
      checkCommand: "bun --bun run ci",
      permissions: {
        github: {
          contents: "write",
          pullRequests: "write",
          issues: "read",
          deployments: "read",
          statuses: "read",
          checks: "read",
        },
      },
      composioToolkitSlugs: ["linear"],
      githubActions: {
        open_pull_request: true,
        comment_on_pr_or_issue: true,
      },
      writeScope: { mode: "this_repo" },
      requireCiGreenForMerge: true,
      modelId: "gateway/model",
      triggers: [
        {
          name: "A pull request changes",
          kind: "github.pull_request",
          status: "enabled",
          conditions: {
            actions: ["opened", "synchronize"],
            branches: ["main"],
          },
          schedule: null,
        },
      ],
    });
    expect(JSON.stringify(payload)).toBe(expectedBytes);

    const fetchImpl = mock(async () => response("agent-1"));
    await submitNewAgent(payload, fetchImpl as unknown as typeof fetch);
    await submitAgentUpdate(
      "agent-1",
      payload,
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/api/background-agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expectedBytes,
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/background-agents/agent-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: expectedBytes,
      },
    );
  });
});
