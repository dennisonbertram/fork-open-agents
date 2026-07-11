/**
 * DOM-interaction tests for the loop builder Save/dirty-state wiring (#877).
 *
 * Bug: the header Save button is wired only to graph mutations (isDirty in
 * use-loop-builder.ts). Editing any Loop settings field (name, description,
 * guardrails, watchdog) in LoopSettingsPanelContent never marks the store
 * dirty, so Save stays disabled and the edit is silently discarded on reload.
 *
 * These tests mount the real BuilderCanvas (with @xyflow/react mocked — it
 * does not render under bun:test, see status-legend.test.tsx), open the Loop
 * settings panel, edit a field, and assert that Save becomes enabled and
 * persists the new value via PATCH /api/agent-loops/:id.
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

mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
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
    json: async () => ({ loop: {} }),
  } as Response;
});
// @ts-expect-error — override global fetch for test
global.fetch = globalFetch;

const canvasPromise = import("./builder-canvas");

/**
 * Types into a controlled text/number input under happy-dom.
 *
 * `fireEvent.change`/`fireEvent.input` alone do not trigger React 19's
 * onChange under this project's happy-dom harness for text/number inputs
 * (verified empirically: works for click/checkbox-driven onChange, not for
 * text inputs — no existing *.dom.test.tsx in this repo exercises typing
 * into a text input, only clicks). Using the native value setter plus an
 * "input" event, a keyUp, and a "change" event together reliably reaches
 * React's ChangeEventPlugin in this environment.
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

describe("BuilderCanvas — Loop settings dirty-state wiring (#877)", () => {
  beforeEach(() => {
    fetchCalls = [];
    globalFetch.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  test("editing a new #870 guardrail field (Agent turns per step) marks dirty and Save PATCHes it", async () => {
    const { BuilderCanvas } = await canvasPromise;
    const { container } = render(
      <BuilderCanvas
        loopId="loop-1"
        loopName="My loop"
        loopDescription=""
        loopGuardrails={{ maxAgentTurnsPerStep: 8 }}
        watchdogEnabled={false}
        watchdogInstructions={null}
        watchdogRetryBudget={2}
        definition={VALID_DEF}
      />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: "Loop settings" }));

    await act(async () => {
      typeIntoInput(
        q.getByLabelText("Agent turns per step") as HTMLInputElement,
        "24",
      );
    });

    const save = q.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(q.getByText("Unsaved changes")).toBeTruthy();

    await userClick(save);

    expect(globalFetch).toHaveBeenCalledTimes(1);
    const call = fetchCalls[0];
    expect(call?.url).toBe("/api/agent-loops/loop-1");
    expect(call?.opts?.method).toBe("PATCH");
    const body = JSON.parse(call?.opts?.body as string);
    expect(body.guardrails.maxAgentTurnsPerStep).toBe(24);
    expect(body.definition).toBeTruthy();
    expect(body.definition.nodes).toBeTruthy();
  });

  test("editing a pre-#870 guardrail field (Max steps per run) marks dirty and Save PATCHes it, preserving other fields", async () => {
    const { BuilderCanvas } = await canvasPromise;
    const { container } = render(
      <BuilderCanvas
        loopId="loop-1"
        loopName="My loop"
        loopDescription=""
        loopGuardrails={{ maxAgentTurnsPerStep: 8 }}
        watchdogEnabled={false}
        watchdogInstructions={null}
        watchdogRetryBudget={2}
        definition={VALID_DEF}
      />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: "Loop settings" }));

    await act(async () => {
      typeIntoInput(
        q.getByLabelText("Max steps per run") as HTMLInputElement,
        "40",
      );
    });

    const save = q.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    await userClick(save);

    const call = fetchCalls[0];
    const body = JSON.parse(call?.opts?.body as string);
    expect(body.guardrails.maxStepsPerRun).toBe(40);
    expect(body.guardrails.maxAgentTurnsPerStep).toBe(8);
  });

  test("editing the Name field marks dirty and Save PATCHes the new name", async () => {
    const { BuilderCanvas } = await canvasPromise;
    const { container } = render(
      <BuilderCanvas
        loopId="loop-1"
        loopName="My loop"
        loopDescription=""
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

    const save = q.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    await userClick(save);

    const call = fetchCalls[0];
    const body = JSON.parse(call?.opts?.body as string);
    expect(body.name).toBe("Renamed loop");
  });

  test("enabling the watchdog marks dirty and Save PATCHes watchdogEnabled", async () => {
    const { BuilderCanvas } = await canvasPromise;
    const { container } = render(
      <BuilderCanvas
        loopId="loop-1"
        loopName="My loop"
        loopDescription=""
        definition={VALID_DEF}
      />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: "Loop settings" }));

    await userClick(q.getByRole("switch", { name: "Enable watchdog" }));

    const save = q.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    await userClick(save);

    const call = fetchCalls[0];
    const body = JSON.parse(call?.opts?.body as string);
    expect(body.watchdogEnabled).toBe(true);
  });
});
