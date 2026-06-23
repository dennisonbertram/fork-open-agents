/**
 * Behavior tests for NewAgentBuilder (the /agents/new full-page builder).
 *
 * SSR-only (renderToStaticMarkup) can't drive clicks, so the save flow's
 * "stay on page, return an id" behavior is unit-tested where it actually
 * lives — see ./create-agent-request.test.ts (submitNewAgent). Here we cover
 * what SSR can prove: the template-first entry and no redirect on mount.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const push = mock((_url: string) => undefined);
let swrKey: string | null = null;

type MockReadinessData = {
  enabled: boolean;
  ready: boolean;
  missing: string[];
  checks: {
    id: string;
    label: string;
    status: "ready" | "missing" | "disabled";
    detail: string;
    missing: string[];
  }[];
};

let readinessData: MockReadinessData = {
  enabled: true,
  ready: true,
  missing: [],
  checks: [],
};

mock.module("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ owner: "acme", repo: "widgets" }),
}));

mock.module("swr", () => ({
  default: (key: string) => {
    swrKey = key;
    return {
      data: readinessData,
      error: null,
      isLoading: false,
      mutate: async () => undefined,
    };
  },
}));

mock.module("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

mock.module("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <button type="button">{children}</button>),
}));

mock.module("@/components/ui/readiness-verdict", () => ({
  ReadinessVerdict: ({
    headline,
    subtext,
    action,
    checks,
  }: {
    headline: string;
    subtext?: string;
    action?: React.ReactNode;
    checks?: { label: string }[];
  }) => (
    <div>
      <p>{headline}</p>
      {subtext ? <p>{subtext}</p> : null}
      {action}
      {checks?.length ? <button type="button">Operator details</button> : null}
    </div>
  ),
}));

// Echo key props so we can assert the spec editor is/ isn't mounted.
mock.module("../agent-spec-editor", () => ({
  AgentSpecEditor: ({ createdAgentId }: { createdAgentId: string | null }) => (
    <div data-testid="agent-spec-editor">
      AgentSpecEditor:{createdAgentId ?? "none"}
    </div>
  ),
}));

mock.module("../template-picker", () => ({
  TemplatePicker: () => <div>TemplatePicker: PR Backlog Maintainer Blank</div>,
}));

const builderPromise = import("./new-agent-builder");

describe("NewAgentBuilder", () => {
  beforeEach(() => {
    push.mockClear();
    swrKey = null;
    readinessData = {
      enabled: true,
      ready: true,
      missing: [],
      checks: [],
    };
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

  test("checks repo-specific background agent prerequisites", async () => {
    const { NewAgentBuilder } = await builderPromise;

    renderToStaticMarkup(<NewAgentBuilder owner="acme" repo="widgets" />);

    expect(swrKey).toBe(
      "/api/background-agents/readiness?repoOwner=acme&repoName=widgets&permission=write",
    );
  });

  test("shows drafting status when launched from Create with AI", async () => {
    const { NewAgentBuilder } = await builderPromise;

    const html = renderToStaticMarkup(
      <NewAgentBuilder
        owner="acme"
        repo="widgets"
        aiPrompt="Label newly opened issues and leave a triage note."
      />,
    );

    expect(html).toContain("Drafting an agent spec from your description.");
    expect(html).toContain("TemplatePicker");
  });

  test("shows setup details and a configuration link when prerequisites are missing", async () => {
    readinessData = {
      enabled: true,
      ready: false,
      missing: ["GITHUB_APP_ID"],
      checks: [
        {
          id: "github_app",
          label: "GitHub App",
          status: "missing",
          detail: "Required for webhook trust.",
          missing: ["GITHUB_APP_ID"],
        },
      ],
    };
    const { NewAgentBuilder } = await builderPromise;

    const html = renderToStaticMarkup(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Background agents need a bit more setup.");
    expect(html).toContain("1 prerequisite needs attention.");
    expect(html).toContain("Open background agent settings");
    expect(html).toContain("/settings/background-agents");
    expect(html).toContain("Operator details");
    expect(html).not.toContain("GITHUB_APP_ID");
  });
});
