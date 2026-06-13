/**
 * Gate-UX regression tests (issue #392)
 *
 * Pins all flag-off behaviors in one file so any future change that removes
 * gating from any page or component causes an immediate red here.
 *
 * REG-GATE-001: /loops/new flag-off → disabled banner present, no form field
 * REG-GATE-002: /loops flag-off → no /loops/new header link
 * REG-GATE-003: LoopsList EmptyState createEnabled=false → no /loops/new link
 * REG-GATE-004: LoopCreateForm label is title-case "Name"
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// ── Shared mocks ──────────────────────────────────────────────────────────────

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user_1", name: "Alice" } }),
}));

mock.module("next/navigation", () => ({
  redirect: (_url: string) => {
    throw new Error("REDIRECT");
  },
  useRouter: () => ({ push: () => undefined, back: () => undefined }),
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

// Config — always disabled for gate regression
mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => false,
}));

// LoopCreateForm stub for page tests (page checks flag and should not render form)
mock.module("./loop-create-form", () => ({
  LoopCreateForm: () => <input id="loop-name" />,
}));

// SWR stub
mock.module("swr", () => ({
  default: () => ({ data: { loops: [] }, error: undefined, isLoading: false }),
}));

// sonner stub
mock.module("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));

const newPageModule = import("./new/page");
const loopsPageModule = import("./page");
const loopsListModule = import("./loops-list");

// ── Regression tests ──────────────────────────────────────────────────────────

describe("Regression: Gate UX (flag off)", () => {
  // REG-GATE-001: /loops/new with flag off — banner, no form
  test("REG-GATE-001: /loops/new disabled → banner with env var hint, no form", async () => {
    const { default: NewLoopPage } = await newPageModule;
    const html = renderToStaticMarkup(
      await NewLoopPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Loops are disabled");
    expect(html).toContain("AGENT_LOOPS_ENABLED");
    expect(html).not.toContain("loop-name");
  });

  // REG-GATE-002: /loops page with flag off — no /loops/new link
  test("REG-GATE-002: /loops disabled → no New loop header link", async () => {
    const { default: LoopsPage } = await loopsPageModule;
    const html = renderToStaticMarkup(await LoopsPage());

    expect(html).not.toContain('href="/loops/new"');
  });

  // REG-GATE-003: LoopsList EmptyState with createEnabled=false — no /loops/new link
  test("REG-GATE-003: LoopsList createEnabled=false → EmptyState has no /loops/new link", async () => {
    const { LoopsList } = await loopsListModule;
    const html = renderToStaticMarkup(<LoopsList createEnabled={false} />);

    expect(html).not.toContain("/loops/new");
  });
});

// REG-GATE-004 lives in loop-create-form.test.tsx (extended) to avoid mock
// contamination with the LoopCreateForm stub used in REG-GATE-001/002.
