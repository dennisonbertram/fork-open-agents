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
  fireEvent,
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
let fetchStatus = 200;
let fetchBody: Record<string, unknown> = { runId: "run-xyz", created: true };
const globalFetch = mock(async (url: string, opts?: RequestInit) => {
  fetchCalls.push({ url, opts });
  return {
    ok: fetchStatus >= 200 && fetchStatus < 300,
    status: fetchStatus,
    json: async () => fetchBody,
  } as Response;
});
// @ts-expect-error — override global fetch for test
global.fetch = globalFetch;

const canvasPromise = import("./builder-canvas");

/**
 * Types into a controlled text/number input under happy-dom.
 *
 * `fireEvent.change`/`fireEvent.input` alone do not trigger React 19's
 * onChange under this project's happy-dom harness for text/number inputs.
 * Using the native value setter plus an "input" event, a keyUp, and a
 * "change" event together reliably reaches React's ChangeEventPlugin in
 * this environment (see builder-settings-save.dom.test.tsx).
 */
function typeIntoInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  input.focus();
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  fireEvent.keyUp(input, { key: value.slice(-1) || "a" });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

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
    fetchStatus = 200;
    fetchBody = { runId: "run-xyz", created: true };
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

  test("Automation variant keeps navigation canonical and warns that Run now performs real work", async () => {
    const { BuilderCanvas } = await canvasPromise;
    const { container } = render(
      <BuilderCanvas
        loopId="loop-1"
        loopName="My loop"
        loopDescription=""
        loopStatus="active"
        definition={VALID_DEF}
        surface="automation"
      />,
    );
    const q = within(container);

    expect(q.getByRole("link", { name: "Automations" })).toBeTruthy();
    expect(
      q.getByRole("link", { name: "View Automation" }).getAttribute("href"),
    ).toBe("/automations/agent-loop/loop-1");
    expect(
      q.getByText(
        "Run now starts real unattended work with the configured repository permissions.",
      ),
    ).toBeTruthy();

    await act(async () => {
      await userClick(q.getByRole("button", { name: "Run now" }));
    });

    expect(routerPush).toHaveBeenCalledWith("/runs/loop/run-xyz");
  });

  test("Automation variant keeps typed dispatch failure evidence on canonical Runs", async () => {
    fetchStatus = 502;
    fetchBody = { errorKind: "dispatch_failed", runId: "failed-run" };
    const { BuilderCanvas } = await canvasPromise;
    const { container } = render(
      <BuilderCanvas
        loopId="loop-1"
        loopName="My loop"
        loopDescription=""
        loopStatus="active"
        definition={VALID_DEF}
        surface="automation"
      />,
    );

    await act(async () => {
      await userClick(
        within(container).getByRole("button", { name: "Run now" }),
      );
    });

    expect(routerPush).toHaveBeenCalledWith("/runs/loop/failed-run");
    expect(toastError).toHaveBeenCalled();
  });

  test("active loop with unsaved builder edits: Run now is disabled with a Save your changes first reason", async () => {
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

    await userClick(q.getByRole("button", { name: "Loop settings" }));

    await act(async () => {
      typeIntoInput(
        q.getByLabelText("Name") as HTMLInputElement,
        "Renamed loop",
      );
    });

    expect(q.getByText("Unsaved changes")).toBeTruthy();

    const btn = q.getByRole("button", {
      name: "Run now",
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(q.getByText("Save your changes first")).toBeTruthy();
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
