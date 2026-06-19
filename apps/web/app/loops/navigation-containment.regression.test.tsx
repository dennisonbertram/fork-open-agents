/**
 * Issue #411: loops stay inside the app shell and use reachable breadcrumbs.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GetAgentLoopResponse } from "@/app/api/agent-loops/types";

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user_1", name: "Alice" } }),
}));

mock.module("next/navigation", () => ({
  redirect: (_url: string) => {
    throw new Error("REDIRECT");
  },
  useRouter: () => ({ push: mock(() => undefined) }),
}));

mock.module("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a className={className} href={href}>
      {children}
    </a>
  ),
}));

mock.module("swr", () => ({
  default: <T,>(
    _key: string,
    _fetcher?: unknown,
    opts?: { fallbackData?: T },
  ) => ({
    data: opts?.fallbackData,
    mutate: mock(() => Promise.resolve()),
  }),
}));

mock.module("sonner", () => ({
  toast: { success: mock(() => undefined), error: mock(() => undefined) },
}));

let loopsEnabled = true;
mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => loopsEnabled,
}));

const loopsPageModulePromise = import("./page");
const loopDetailModulePromise = import("./[loopId]/loop-detail");

function makeLoopData(): GetAgentLoopResponse {
  return {
    loop: {
      id: "loop_abc",
      name: "Repo maintenance",
      repoOwner: "acme",
      repoName: "widgets",
      status: "active",
      description: null,
      guardrails: null,
      definition: { nodes: [], edges: [] },
      permissions: {},
      watchdogEnabled: false,
      watchdogInstructions: null,
      watchdogRetryBudget: 2,
      userId: "user_1",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
    triggers: [],
  };
}

describe("loops navigation containment", () => {
  test("builder fills the shell container instead of the viewport", () => {
    const source = readFileSync(
      join(import.meta.dir, "[loopId]/builder/builder-canvas.tsx"),
      "utf8",
    );

    expect(source).not.toContain("h-screen");
    expect(source).toContain('className="flex min-h-0 flex-1 flex-col');
  });

  test("loop detail breadcrumbs point at reachable ancestors, not repo loops", async () => {
    const { LoopDetail } = await loopDetailModulePromise;
    const html = renderToStaticMarkup(
      <LoopDetail loopId="loop_abc" initialLoopData={makeLoopData()} />,
    );

    expect(html).toContain('aria-label="Loop breadcrumb"');
    expect(html).toContain('href="/loops"');
    expect(html).toContain('href="/repos/acme/widgets"');
    expect(html).not.toContain('href="/repos/acme/widgets/loops"');
  });

  test("global loops page includes a workspace breadcrumb", async () => {
    loopsEnabled = true;
    const { default: LoopsPage } = await loopsPageModulePromise;
    const html = renderToStaticMarkup(await LoopsPage());

    expect(html).toContain('aria-label="Loop breadcrumb"');
    expect(html).toContain('href="/sessions"');
    expect(html).toContain('href="/loops"');
  });
});
