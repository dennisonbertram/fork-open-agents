/**
 * #1092: when a Settings > Agents fetch fails, AgentsLoader used to fall
 * through its `isLoading` guard and render an editable roster built from
 * hardcoded fallbacks (default model, zero per-agent overrides). Saving from
 * that view overwrites the user's real settings, so a failed load must render
 * a distinguishable failure state and no editable roster.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let agentsSwrError: Error | null = null;

mock.module("swr", () => ({
  default: (key: string | null) => ({
    data:
      key === "/api/settings/agents"
        ? agentsSwrError
          ? undefined
          : { agents: [] }
        : {},
    error: key === "/api/settings/agents" ? agentsSwrError : null,
    isLoading: false,
    mutate: () => {},
  }),
}));

mock.module("./agents-section", () => ({
  AgentsSection: () => <div>AGENT_ROSTER_RENDERED</div>,
  AgentsSectionSkeleton: () => <div>AGENT_ROSTER_SKELETON</div>,
}));

const loaderModulePromise = import("./agents-loader");

describe("AgentsLoader load failure (#1092)", () => {
  beforeEach(() => {
    agentsSwrError = null;
  });

  test("renders a failure state instead of a fallback roster when a fetch fails", async () => {
    agentsSwrError = new Error("boom");

    const { AgentsLoader } = await loaderModulePromise;
    const html = renderToStaticMarkup(<AgentsLoader />);

    expect(html).toContain("Failed to load agent settings");
    expect(html).toContain("Retry");
    expect(html).not.toContain("AGENT_ROSTER_RENDERED");
  });

  test("still renders the roster when every fetch succeeds", async () => {
    const { AgentsLoader } = await loaderModulePromise;
    const html = renderToStaticMarkup(<AgentsLoader />);

    expect(html).toContain("AGENT_ROSTER_RENDERED");
    expect(html).not.toContain("Failed to load agent settings");
  });
});
