import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const redirect = mock((path: string) => {
  throw new Error(`redirect:${path}`);
});
const notFound = mock(() => {
  throw new Error("not-found");
});
let sessionUserId: string | null = "user-1";
let ownedAgent: Record<string, unknown> | null;
const getOwnedBackgroundAgentWithTriggers = mock(async () => ownedAgent);

mock.module("next/navigation", () => ({ redirect, notFound }));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId ? { user: { id: sessionUserId } } : null,
}));
mock.module("@/lib/background-agents/store", () => ({
  getOwnedBackgroundAgentWithTriggers,
}));
mock.module("./automation-agent-edit-experience", () => ({
  AutomationAgentEditExperience: ({ agent }: { agent: { id: string } }) => (
    <div data-testid="automation-edit-experience" data-agent-id={agent.id} />
  ),
}));

const pageModulePromise = import("./page");

describe("canonical single-step Automation edit page", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    ownedAgent = {
      id: "agent-1",
      userId: "user-1",
      name: "PR reviewer",
      repoOwner: "acme",
      repoName: "widgets",
    };
    redirect.mockClear();
    notFound.mockClear();
    getOwnedBackgroundAgentWithTriggers.mockClear();
  });

  test("redirects signed-out users before ownership lookup", async () => {
    sessionUserId = null;
    const { default: AutomationEditPage } = await pageModulePromise;

    await expect(
      AutomationEditPage({
        params: Promise.resolve({ agentId: "agent-1" }),
      }),
    ).rejects.toThrow("redirect:/");
    expect(getOwnedBackgroundAgentWithTriggers).not.toHaveBeenCalled();
  });

  test("uses authenticated ownership and fails closed for missing or foreign ids", async () => {
    ownedAgent = null;
    const { default: AutomationEditPage } = await pageModulePromise;

    await expect(
      AutomationEditPage({
        params: Promise.resolve({ agentId: "foreign-agent" }),
      }),
    ).rejects.toThrow("not-found");
    expect(getOwnedBackgroundAgentWithTriggers).toHaveBeenCalledWith({
      userId: "user-1",
      agentId: "foreign-agent",
    });
  });

  test("derives fixed repository context from the owned record and stays in Automations", async () => {
    const { default: AutomationEditPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await AutomationEditPage({
        params: Promise.resolve({ agentId: "agent-1" }),
      }),
    );

    expect(html).toContain("Edit single-step Automation");
    expect(html).toContain("acme/widgets");
    expect(html).toContain('href="/automations/background-agent/agent-1"');
    expect(html).toContain('data-agent-id="agent-1"');
  });
});
