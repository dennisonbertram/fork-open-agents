/**
 * Tests for AgentEditForm — edit page client component wrapping AgentSpecEditor.
 * WI-6: Make the agent Edit button real.
 *
 * Behavioral tests:
 * BT-WI6-001: Form renders prefilled with fixture agent's name and instructions
 * BT-WI6-002: buildEditPatch returns correct PATCH payload with edited name
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";

// --- Mocks -------------------------------------------------------------------

const push = mock((_url: string) => undefined);
const refresh = mock(() => undefined);

mock.module("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

mock.module("sonner", () => ({
  toast: {
    success: mock((_msg: string) => undefined),
    error: mock((_msg: string) => undefined),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fetchResult: { ok: boolean; json: () => Promise<any> } = {
  ok: true,
  json: async () => ({ agent: {} }),
};

const globalFetch = mock(async (_url: string, _opts?: unknown) => fetchResult);
// @ts-expect-error — override global fetch for test
global.fetch = globalFetch;

// --- Helpers -----------------------------------------------------------------

function makeAgent(
  overrides: Partial<BackgroundAgentWithTriggers> = {},
): BackgroundAgentWithTriggers {
  return {
    id: "agent-edit-1",
    userId: "user-1",
    name: "PR Smoke Tester",
    description: "Runs smoke checks on pull requests.",
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Review the PR diff and run smoke checks.",
    permissions: {},
    outputMode: "none",
    checkCommand: "bun --bun run ci",
    composioToolkitSlugs: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    triggers: [
      {
        id: "trigger-1",
        agentId: "agent-edit-1",
        loopId: null,
        userId: "user-1",
        name: "On pull request",
        kind: "github.pull_request",
        status: "enabled",
        conditions: { actions: ["opened", "synchronize"] },
        schedule: null,
        webhookPublicId: null,
        webhookSecretHash: null,
        lastRunAt: null,
        nextRunAt: null,
        lastSkipReason: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ],
    ...overrides,
  };
}

// --- Tests -------------------------------------------------------------------

// Module is imported here — will fail until the module exists (RED state)
const editFormModulePromise = import("./agent-edit-form");

describe("AgentEditForm", () => {
  test("BT-WI6-001: renders prefilled with fixture agent name and instructions", async () => {
    const { AgentEditForm } = await editFormModulePromise;
    const agent = makeAgent();

    const html = renderToStaticMarkup(
      <AgentEditForm agent={agent} owner="acme" repo="widgets" />,
    );

    // The form should be prefilled with the agent name
    expect(html).toContain("PR Smoke Tester");
    // The form should be prefilled with the agent instructions
    expect(html).toContain("Review the PR diff and run smoke checks.");
  });

  test("BT-WI6-002: buildEditPatch returns correct payload with name and instructions", async () => {
    const { buildEditPatch } = await editFormModulePromise;

    const form = {
      name: "Updated Name",
      repoOwner: "acme",
      repoName: "widgets",
      triggerKind: "github.pull_request" as const,
      schedule: "",
      conditionActions: "opened",
      conditionBranches: "",
      conditionLabels: "",
      conditionEnvironments: "",
      conditionSeverities: "",
      instructions: "Updated instructions for the agent.",
      outputMode: "none" as const,
      checkCommand: "",
      enabled: true,
    };

    const patch = buildEditPatch(form);

    expect(patch.name).toBe("Updated Name");
    expect(patch.instructions).toBe("Updated instructions for the agent.");
    expect(patch.status).toBe("enabled");
    expect(Array.isArray(patch.triggers)).toBe(true);
    expect(patch.triggers[0]?.kind).toBe("github.pull_request");
  });
});
