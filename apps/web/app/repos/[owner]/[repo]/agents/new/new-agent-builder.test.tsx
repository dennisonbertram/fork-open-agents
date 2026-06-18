/**
 * Behavior tests for NewAgentBuilder (the /agents/new full-page builder).
 *
 * SSR-only (renderToStaticMarkup) can't drive clicks, so the save flow's
 * "stay on page, return an id" behavior is unit-tested where it actually
 * lives — see ./create-agent-request.test.ts (submitNewAgent / updateExistingAgent)
 * and ./save-agent-spec.test.ts (the create-once-then-PATCH routing the builder
 * uses). Here we cover what SSR can prove: the template-first entry and no
 * redirect on mount.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const push = mock((_url: string) => undefined);

mock.module("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ owner: "acme", repo: "widgets" }),
}));

mock.module("swr", () => ({
  default: (_key: string) => ({
    data: { enabled: true, ready: true, missing: [] },
    error: null,
    isLoading: false,
    mutate: async () => undefined,
  }),
}));

// Echo key props so we can assert the spec editor is/ isn't mounted.
mock.module("../agent-spec-editor", () => ({
  AgentSpecEditor: ({ createdAgentId }: { createdAgentId: string | null }) => (
    <div data-testid="agent-spec-editor">
      AgentSpecEditor:{createdAgentId ?? "none"}
    </div>
  ),
}));

const builderPromise = import("./new-agent-builder");

describe("NewAgentBuilder", () => {
  beforeEach(() => {
    push.mockClear();
  });

  test("template-first: initial render shows the chooser, not the spec editor", async () => {
    const { NewAgentBuilder } = await builderPromise;

    const html = renderToStaticMarkup(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );

    expect(html).toContain("PR Backlog Maintainer");
    expect(html).toContain("Blank");
    expect(html).not.toContain("agent-spec-editor");
  });

  test("does not redirect on mount (the builder stays on /agents/new)", async () => {
    const { NewAgentBuilder } = await builderPromise;

    renderToStaticMarkup(<NewAgentBuilder owner="acme" repo="widgets" />);

    expect(push).not.toHaveBeenCalled();
  });
});
