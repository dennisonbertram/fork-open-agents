/**
 * InboxSidebar repo sub-groups tests — Agents and Loops (#403)
 *
 * Behavior contracts:
 *   BT-SG-001: filterAgentsByRepo returns agents matching owner/name case-insensitively
 *   BT-SG-002: filterAgentsByRepo returns empty array for no matches
 *   BT-SG-003: RepoAgentsSubGroup renders agent items with correct hrefs and count
 *   BT-SG-004: RepoAgentsSubGroup "+" links to /repos/{owner}/{repo}/agents
 *   BT-SG-005: RepoAgentsSubGroup shows empty state when no agents
 *   BT-SG-006: RepoLoopsSubGroup hidden when featureDisabled is true
 *   BT-SG-007: RepoLoopsSubGroup renders loop items with correct hrefs
 *   BT-SG-008: RepoLoopsSubGroup "+" links to /loops/new?repoOwner=…&repoName=…
 *   BT-SG-009: RepoLoopsSubGroup shows empty state when no loops
 *   BT-SG-010: getRepoSubGroupRailActions returns accessible rail links
 *   BT-SG-011: getRepoSubGroupRailActions hides loops when disabled
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// ── Module mocks (must be hoisted before dynamic imports) ─────────────────────

mock.module("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

mock.module("swr", () => ({
  default: () => ({ data: undefined, error: undefined, isLoading: false }),
}));

// ── Import module under test ───────────────────────────────────────────────────

const modulePromise = import("./inbox-sidebar-repo-subgroups");

// ── Test data ─────────────────────────────────────────────────────────────────

function makeAgent(
  overrides: Partial<{
    id: string;
    name: string;
    repoOwner: string;
    repoName: string;
    status: "enabled" | "disabled";
  }> = {},
) {
  return {
    id: overrides.id ?? "agent-1",
    name: overrides.name ?? "My Agent",
    repoOwner: overrides.repoOwner ?? "myorg",
    repoName: overrides.repoName ?? "myrepo",
    status: overrides.status ?? "enabled",
  };
}

function makeLoop(
  overrides: Partial<{
    id: string;
    name: string;
    status: string;
  }> = {},
) {
  return {
    id: overrides.id ?? "loop-1",
    name: overrides.name ?? "My Loop",
    status: overrides.status ?? "active",
  };
}

// ── Pure helper tests ─────────────────────────────────────────────────────────

describe("filterAgentsByRepo", () => {
  // BT-SG-001: filtering returns matching agents
  test("BT-SG-001: returns agents matching owner/name case-insensitively", async () => {
    const { filterAgentsByRepo } = await modulePromise;
    const agents = [
      makeAgent({ id: "a1", repoOwner: "MyOrg", repoName: "MyRepo" }),
      makeAgent({ id: "a2", repoOwner: "other", repoName: "other" }),
      makeAgent({ id: "a3", repoOwner: "myorg", repoName: "myrepo" }),
    ];

    const result = filterAgentsByRepo(agents, "myorg", "myrepo");

    expect(result).toHaveLength(2);
    const ids = result.map((a) => a.id);
    expect(ids).toContain("a1");
    expect(ids).toContain("a3");
    expect(ids).not.toContain("a2");
  });

  // BT-SG-002: empty result when no matches
  test("BT-SG-002: returns empty array when no agents match repo", async () => {
    const { filterAgentsByRepo } = await modulePromise;
    const agents = [makeAgent({ repoOwner: "other", repoName: "other" })];

    const result = filterAgentsByRepo(agents, "myorg", "myrepo");

    expect(result).toHaveLength(0);
  });
});

// ── Component tests ───────────────────────────────────────────────────────────

describe("RepoAgentsSubGroup", () => {
  // BT-SG-003: renders agent items with hrefs and count
  test("BT-SG-003: renders agent items with correct hrefs and count", async () => {
    const { RepoAgentsSubGroup } = await modulePromise;

    const agents = [
      makeAgent({
        id: "agent-abc",
        name: "Deploy Bot",
        repoOwner: "myorg",
        repoName: "myrepo",
      }),
      makeAgent({
        id: "agent-def",
        name: "Review Bot",
        repoOwner: "myorg",
        repoName: "myrepo",
      }),
    ];

    const html = renderToStaticMarkup(
      <RepoAgentsSubGroup
        repoOwner="myorg"
        repoName="myrepo"
        agents={agents}
        initialExpanded={true}
      />,
    );

    expect(html).toContain("/repos/myorg/myrepo/agents/agent-abc");
    expect(html).toContain("/repos/myorg/myrepo/agents/agent-def");
    expect(html).toContain("Deploy Bot");
    expect(html).toContain("Review Bot");
    // Count should be 2
    expect(html).toContain("2");
  });

  // BT-SG-004: "+" button links to agents index
  test("BT-SG-004: + button links to /repos/{owner}/{repo}/agents", async () => {
    const { RepoAgentsSubGroup } = await modulePromise;

    const html = renderToStaticMarkup(
      <RepoAgentsSubGroup
        repoOwner="myorg"
        repoName="myrepo"
        agents={[]}
        initialExpanded={true}
      />,
    );

    expect(html).toContain("/repos/myorg/myrepo/agents");
  });

  // BT-SG-005: empty state
  test("BT-SG-005: shows empty state when no agents", async () => {
    const { RepoAgentsSubGroup } = await modulePromise;

    const html = renderToStaticMarkup(
      <RepoAgentsSubGroup
        repoOwner="myorg"
        repoName="myrepo"
        agents={[]}
        initialExpanded={true}
      />,
    );

    expect(html).toContain("No agents yet");
  });
});

describe("RepoLoopsSubGroup", () => {
  // BT-SG-006: hidden when featureDisabled
  test("BT-SG-006: renders nothing when featureDisabled is true", async () => {
    const { RepoLoopsSubGroup } = await modulePromise;

    const html = renderToStaticMarkup(
      <RepoLoopsSubGroup
        repoOwner="myorg"
        repoName="myrepo"
        loops={null}
        featureDisabled={true}
        initialExpanded={false}
      />,
    );

    expect(html).toBe("");
  });

  // BT-SG-007: renders loop items with correct hrefs
  test("BT-SG-007: renders loop items with correct hrefs", async () => {
    const { RepoLoopsSubGroup } = await modulePromise;

    const loops = [
      makeLoop({ id: "loop-abc", name: "Nightly Check" }),
      makeLoop({ id: "loop-def", name: "Daily Deploy" }),
    ];

    const html = renderToStaticMarkup(
      <RepoLoopsSubGroup
        repoOwner="myorg"
        repoName="myrepo"
        loops={loops}
        featureDisabled={false}
        initialExpanded={true}
      />,
    );

    expect(html).toContain("/loops/loop-abc");
    expect(html).toContain("/loops/loop-def");
    expect(html).toContain("Nightly Check");
    expect(html).toContain("Daily Deploy");
    // Count should be 2
    expect(html).toContain("2");
  });

  // BT-SG-008: "+" button links to /loops/new with search params
  test("BT-SG-008: + button links to /loops/new?repoOwner=…&repoName=…", async () => {
    const { RepoLoopsSubGroup } = await modulePromise;

    const html = renderToStaticMarkup(
      <RepoLoopsSubGroup
        repoOwner="myorg"
        repoName="myrepo"
        loops={[]}
        featureDisabled={false}
        initialExpanded={true}
      />,
    );

    expect(html).toContain("/loops/new?repoOwner=myorg&amp;repoName=myrepo");
  });

  // BT-SG-009: empty state
  test("BT-SG-009: shows empty state when loops list is empty", async () => {
    const { RepoLoopsSubGroup } = await modulePromise;

    const html = renderToStaticMarkup(
      <RepoLoopsSubGroup
        repoOwner="myorg"
        repoName="myrepo"
        loops={[]}
        featureDisabled={false}
        initialExpanded={true}
      />,
    );

    expect(html).toContain("No loops yet");
  });

  // BT-SG-012 (#768): create link must not rely solely on hover to be
  // reachable. Root cause of the dead sidebar click (repro: click lands,
  // URL stays /sessions, zero console errors) is that this link is
  // `opacity-0` at rest and only becomes visible/clickable via
  // `group-hover/sub:opacity-100` — a user (or a scripted click) landing on
  // the header row without triggering CSS :hover, or scrolling to a row
  // that briefly renders before hover state settles, sees and can target a
  // link that has zero effective opacity. The link must be reachable via
  // keyboard focus at minimum (focus-visible reveals it), and must not sit
  // at opacity 0 when not covered by any occluding element.
  test("BT-SG-012: create link is keyboard-focusable and reveals on focus, not hover-only", async () => {
    const { RepoLoopsSubGroup } = await modulePromise;

    const html = renderToStaticMarkup(
      <RepoLoopsSubGroup
        repoOwner="myorg"
        repoName="myrepo"
        loops={[]}
        featureDisabled={false}
        initialExpanded={true}
      />,
    );

    // The create link's class list must expose a focus-visible reveal so
    // keyboard users (and low-precision pointer paths) can reach it without
    // depending on true CSS :hover.
    expect(html).toMatch(/focus-visible:opacity-100/);
  });
});

describe("getRepoSubGroupRailActions", () => {
  test("BT-SG-010: returns accessible rail links for Agents and Loops", async () => {
    const { getRepoSubGroupRailActions } = await modulePromise;

    const actions = getRepoSubGroupRailActions({
      repoOwner: "myorg",
      repoName: "myrepo",
      agents: [makeAgent({ id: "agent-1" })],
      loops: [makeLoop({ id: "loop-1" }), makeLoop({ id: "loop-2" })],
      loopsFeatureDisabled: false,
    });

    expect(actions.map((action) => action.id)).toEqual(["agents", "loops"]);
    expect(actions[0]?.href).toBe("/repos/myorg/myrepo/agents");
    expect(actions[0]?.ariaLabel).toContain("myorg/myrepo");
    expect(actions[0]?.count).toBe(1);
    expect(actions[1]?.href).toBe("/loops?repoOwner=myorg&repoName=myrepo");
    expect(actions[1]?.tooltip).toContain("2");
  });

  test("BT-SG-011: hides Loops rail link when loops are disabled", async () => {
    const { getRepoSubGroupRailActions } = await modulePromise;

    const actions = getRepoSubGroupRailActions({
      repoOwner: "myorg",
      repoName: "myrepo",
      agents: [],
      loops: null,
      loopsFeatureDisabled: true,
    });

    expect(actions.map((action) => action.id)).toEqual(["agents"]);
  });
});
