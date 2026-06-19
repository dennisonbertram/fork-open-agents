/**
 * /loops page server-component tests (issue #392)
 *
 * Behavior contract:
 *   BT-LOOPS-GATE-003: Flag off → no href="/loops/new" in header
 *   BT-LOOPS-GATE-004: Flag on  → header "New loop" link is present
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

// SWR stub for LoopsList
mock.module("swr", () => ({
  default: () => ({ data: { loops: [] }, error: undefined, isLoading: false }),
}));

// Config mock — mutated per test
let _loopsEnabled = false;
mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => _loopsEnabled,
}));

const pageModulePromise = import("./page");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("/loops page", () => {
  // BT-LOOPS-GATE-003: flag off → no /loops/new link in header
  test("BT-LOOPS-GATE-003: flag off → page renders NO href=/loops/new link", async () => {
    _loopsEnabled = false;

    const { default: LoopsPage } = await pageModulePromise;
    const html = renderToStaticMarkup(await LoopsPage());

    expect(html).not.toContain('href="/loops/new"');
  });

  // BT-LOOPS-GATE-004: flag on → header "New loop" link present
  test("BT-LOOPS-GATE-004: flag on → header New loop link is present", async () => {
    _loopsEnabled = true;

    const { default: LoopsPage } = await pageModulePromise;
    const html = renderToStaticMarkup(await LoopsPage());

    expect(html).toContain('href="/loops/new"');
    expect(html).toContain("New loop");
  });
});
