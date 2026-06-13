/**
 * /loops/new page server-component tests (issue #392)
 *
 * Behavior contract:
 *   BT-LOOPS-GATE-001: Flag off → disabled banner rendered, no form field
 *   BT-LOOPS-GATE-002: Flag on  → LoopCreateForm rendered with prefill props
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

// LoopCreateForm — track render calls
let _formRendered = false;
mock.module("../loop-create-form", () => ({
  LoopCreateForm: (props: {
    initialRepoOwner?: string;
    initialRepoName?: string;
  }) => {
    _formRendered = true;
    return <input id="loop-name" data-owner={props.initialRepoOwner ?? ""} />;
  },
}));

const pageModulePromise = import("./page");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("/loops/new page", () => {
  // BT-LOOPS-GATE-001: flag off → banner, no form
  test("BT-LOOPS-GATE-001: flag off → shows disabled banner and NO form fields", async () => {
    _loopsEnabled = false;
    _formRendered = false;

    const { default: NewLoopPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await NewLoopPage({
        searchParams: Promise.resolve({}),
      }),
    );

    // Banner copy must be present
    expect(html).toContain("Loops are disabled");
    expect(html).toContain("AGENT_LOOPS_ENABLED");

    // The create form must NOT be present
    expect(html).not.toContain("loop-name");
    expect(_formRendered).toBe(false);
  });

  // BT-LOOPS-GATE-002: flag on → form renders with prefill props
  test("BT-LOOPS-GATE-002: flag on → form renders with prefill props intact", async () => {
    _loopsEnabled = true;
    _formRendered = false;

    const { default: NewLoopPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await NewLoopPage({
        searchParams: Promise.resolve({ repoOwner: "acme", repoName: "app" }),
      }),
    );

    // Form must render
    expect(html).toContain("loop-name");
    expect(_formRendered).toBe(true);

    // Prefill props passed through
    expect(html).toContain("acme");
  });
});
