/**
 * DOM-interaction tests for the loop builder header path-forward affordances
 * (#894): a persistent status chip, an always-enabled "View loop" link, and a
 * "Run now" button (enabled only when status === "active"; disabled with a
 * visible inline reason otherwise).
 *
 * Naming convention: `*.dom.test.tsx` opts into the happy-dom environment via
 * the first import below (@/tests/dom). This must remain the FIRST import.
 */

import {
  registerDomTestHooks,
  render,
  within,
  act,
  userClick,
} from "@/tests/dom";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { LoopDefinition } from "@/lib/agent-loops/types";

registerDomTestHooks();

// --- Mocks -------------------------------------------------------------------

mock.module("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Panel: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ViewportPortal: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  BaseEdge: () => null,
  EdgeLabelRenderer: () => null,
  BackgroundVariant: { Dots: "dots" },
  useReactFlow: () => ({
    fitView: () => undefined,
    screenToFlowPosition: (p: unknown) => p,
  }),
  applyNodeChanges: (_c: unknown, items: unknown) => items,
  applyEdgeChanges: (_c: unknown, items: unknown) => items,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  getBezierPath: () => ["M 0 0", 0, 0],
}));

const routerPush = mock((_p: string) => undefined);
mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: routerPush, refresh: () => undefined }),
  usePathname: () => "/loops/loop-1/builder",
}));

mock.module("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children?: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const toastSuccess = mock((_message: string) => undefined);
const toastError = mock((_message: string) => undefined);
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

mock.module("@/app/providers", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

type FetchCall = { url: string; opts?: RequestInit };
let fetchCalls: FetchCall[] = [];
const globalFetch = mock(async (url: string, opts?: RequestInit) => {
  fetchCalls.push({ url, opts });
  return {
    ok: true,
    status: 200,
    json: async () => ({ runId: "run-xyz", created: true }),
  } as Response;
});
// @ts-expect-error — override global fetch for test
global.fetch = globalFetch;

const canvasPromise = import("./builder-canvas");

const VALID_DEF: LoopDefinition = {
  nodes: [
    { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    { id: "end-1", kind: "end", label: "End", position: { x: 200, y: 0 } },
  ],
  edges: [{ id: "e-1", source: "start-1", target: "end-1", when: "always" }],
};

describe("BuilderCanvas — header path-forward affordances (#894)", () => {
  beforeEach(() => {
    fetchCalls = [];
    globalFetch.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    routerPush.mockClear();
  });

  test("renders the loop status chip and a View loop link for a draft loop", async () => {
    const { BuilderCanvas } = await canvasPromise;
    const { container } = render(
      <BuilderCanvas
        loopId="loop-1"
        loopName="My loop"
        loopDescription=""
        loopStatus="draft"
        definition={VALID_DEF}
      />,
    );
    const q = within(container);

    expect(q.getByText("draft")).toBeTruthy();

    const link = q.getByRole("link", { name: "View loop" });
    expect(link.getAttribute("href")).toBe("/loops/loop-1");
  });

  test("disables Run now with a visible inline reason for a draft loop", async () => {
    const { BuilderCanvas } = await canvasPromise;
    const { container } = render(
      <BuilderCanvas
        loopId="loop-1"
        loopName="My loop"
        loopDescription=""
        loopStatus="draft"
        definition={VALID_DEF}
      />,
    );
    const q = within(container);

    const btn = q.getByRole("button", {
      name: "Run now",
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(q.getByText("Set to Active to run")).toBeTruthy();
  });

  test("active loop: Run now click POSTs to the runs endpoint and navigates to the run page", async () => {
    const { BuilderCanvas } = await canvasPromise;
    const { container } = render(
      <BuilderCanvas
        loopId="loop-1"
        loopName="My loop"
        loopDescription=""
        loopStatus="active"
        definition={VALID_DEF}
      />,
    );
    const q = within(container);

    await act(async () => {
      await userClick(q.getByRole("button", { name: "Run now" }));
    });

    const post = fetchCalls.find(
      (c) => c.url === "/api/agent-loops/loop-1/runs",
    );
    expect(post?.opts?.method).toBe("POST");
    expect(routerPush).toHaveBeenCalledWith("/loops/loop-1/runs/run-xyz");
    expect(toastSuccess).toHaveBeenCalledWith("Run started");
  });

  test("dismissing the What happens next banner keeps the header status/View loop/Run now", async () => {
    const { BuilderCanvas } = await canvasPromise;
    const { container } = render(
      <BuilderCanvas
        loopId="loop-1"
        loopName="My loop"
        loopDescription=""
        loopStatus="draft"
        definition={VALID_DEF}
      />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: "Dismiss" }));

    expect(q.getByText("draft")).toBeTruthy();
    expect(q.getByRole("link", { name: "View loop" })).toBeTruthy();
    expect(q.getByRole("button", { name: "Run now" })).toBeTruthy();
  });
});
