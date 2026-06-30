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

  test("(P2D) when prerequisites are ready, the readiness panel is NOT rendered", async () => {
    // ready: true is the default in beforeEach
    const { NewAgentBuilder } = await builderPromise;

    const html = renderToStaticMarkup(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );

    // When ready, ReadinessVerdict should not mount — the "Hosted prerequisites"
    // headline from mapReadinessToVerdict(ready:true) must not appear.
    expect(html).not.toContain("Hosted prerequisites are configured");
    // The alarm panel should not appear at all
    expect(html).not.toContain("Background agents need a bit more setup");
  });

  test("(P2D) when prerequisites are not ready, the panel appears (somewhere in the page)", async () => {
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

    expect(html).toContain("Background agents need a bit more setup");
  });

  test("(P2D) when not ready, the panel does not appear before the template picker in markup", async () => {
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

    const templatePickerIdx = html.indexOf("TemplatePicker");
    const panelIdx = html.indexOf("Background agents need a bit more setup");
    // Template picker must appear before the not-ready panel
    expect(templatePickerIdx).toBeGreaterThanOrEqual(0);
    expect(panelIdx).toBeGreaterThanOrEqual(0);
    expect(templatePickerIdx).toBeLessThan(panelIdx);
  });

  test("REG: ready state — template picker appears without a readiness panel above it", async () => {
    // Guards against accidentally adding the panel back before the picker when ready
    const { NewAgentBuilder } = await builderPromise;
    const html = renderToStaticMarkup(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    // Template picker must appear
    expect(html).toContain("TemplatePicker");
    // No readiness headline should appear for ready state
    expect(html).not.toContain("Hosted prerequisites are configured");
    expect(html).not.toContain("Background agents need");
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
