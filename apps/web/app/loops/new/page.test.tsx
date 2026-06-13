/**
 * /loops/new page server-component tests (issue #392)
 *
 * Behavior contract:
 *   BT-LOOPS-GATE-001: Flag off → disabled banner rendered, no create experience
 *   BT-LOOPS-GATE-002: Flag on  → LoopCreateExperience rendered with prefill props
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user_1", name: "Alice" } }),
}));

mock.module("next/navigation", () => ({
  redirect: (_url: string) => {
    throw new Error("REDIRECT");
  },
}));

mock.module("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// Config mock — mutated per test
let _loopsEnabled = false;
mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => _loopsEnabled,
}));

// LoopCreateExperience — track render calls + prefill props
let _experienceRendered = false;
mock.module("../loop-create-experience", () => ({
  LoopCreateExperience: (props: {
    initialRepoOwner?: string;
    initialRepoName?: string;
  }) => {
    _experienceRendered = true;
    return (
      <div
        id="loop-create-experience"
        data-owner={props.initialRepoOwner ?? ""}
        data-repo={props.initialRepoName ?? ""}
      />
    );
  },
}));

const pageModulePromise = import("./page");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("/loops/new page", () => {
  // BT-LOOPS-GATE-001: flag off → banner, no create experience
  test("BT-LOOPS-GATE-001: flag off → shows disabled banner and NO create experience", async () => {
    _loopsEnabled = false;
    _experienceRendered = false;

    const { default: NewLoopPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await NewLoopPage({
        searchParams: Promise.resolve({}),
      }),
    );

    // Banner copy must be present
    expect(html).toContain("Loops are disabled");
    expect(html).toContain("AGENT_LOOPS_ENABLED");

    // The create experience must NOT be present
    expect(html).not.toContain("loop-create-experience");
    expect(_experienceRendered).toBe(false);
  });

  // BT-LOOPS-GATE-002: flag on → experience renders with prefill props
  test("BT-LOOPS-GATE-002: flag on → create experience renders with prefill props intact", async () => {
    _loopsEnabled = true;
    _experienceRendered = false;

    const { default: NewLoopPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await NewLoopPage({
        searchParams: Promise.resolve({ repoOwner: "acme", repoName: "app" }),
      }),
    );

    // The create experience must render
    expect(html).toContain("loop-create-experience");
    expect(_experienceRendered).toBe(true);

    // Prefill props (repo owner/name) passed through from query params
    expect(html).toContain("acme");
    expect(html).toContain("app");
  });
});
