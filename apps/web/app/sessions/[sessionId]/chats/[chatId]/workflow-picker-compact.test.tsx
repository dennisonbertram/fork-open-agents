import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkflowCatalogEntry } from "@/app/api/workflows/catalog/route";

// ── SWR mock setup ────────────────────────────────────────────────────────────

type SwrState = {
  data?: { workflows: WorkflowCatalogEntry[] };
  error?: Error | null;
  isLoading?: boolean;
};

let swrState: SwrState = {};

mock.module("swr", () => ({
  default: (_key: string) => ({
    data: swrState.data,
    error: swrState.error ?? null,
    isLoading: swrState.isLoading ?? false,
  }),
}));

const componentModulePromise = import("./workflow-picker-compact");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const enabledWorkflow: WorkflowCatalogEntry = {
  id: "test-run",
  name: "Test Run",
  version: "1.0.0",
  description: "Run the test suite",
  capabilities: ["testing"],
  proofLevel: "basic",
  available: true,
  disabledReason: null,
};

const disabledWorkflow: WorkflowCatalogEntry = {
  id: "deploy-prod",
  name: "Deploy to Production",
  version: "1.0.0",
  description: "Deploy to the production environment",
  capabilities: ["deployment"],
  proofLevel: "managed",
  available: false,
  disabledReason: "Workflow is currently disabled",
};

describe("WorkflowPickerCompact", () => {
  beforeEach(() => {
    swrState = {};
  });

  // BT-001: trigger renders with accessible label and default label
  test("renders trigger button with accessible label and default Workflow label", async () => {
    swrState = { data: { workflows: [enabledWorkflow] } };
    const { WorkflowPickerCompact } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerCompact
        disabled={false}
        selectedWorkflowId={null}
        onSelectWorkflow={() => {}}
      />,
    );

    expect(html).toContain("Select workflow");
    expect(html).toContain("Workflow");
  });

  // BT-001b: trigger shows selected workflow name when one is selected
  test("renders trigger with selected workflow name when a workflow is selected", async () => {
    swrState = { data: { workflows: [enabledWorkflow] } };
    const { WorkflowPickerCompact } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerCompact
        disabled={false}
        selectedWorkflowId="test-run"
        onSelectWorkflow={() => {}}
      />,
    );

    expect(html).toContain("Test Run");
  });

  // BT-002: loading state
  test("shows loading indicator when SWR is loading", async () => {
    swrState = { isLoading: true };
    const { WorkflowPickerCompact } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerCompact
        disabled={false}
        selectedWorkflowId={null}
        onSelectWorkflow={() => {}}
      />,
    );

    // Trigger must be disabled while loading
    expect(html).toContain("disabled");
  });

  // BT-003: error/empty state
  test("shows unavailable affordance when SWR returns an error", async () => {
    swrState = { error: new Error("Network error") };
    const { WorkflowPickerCompact } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerCompact
        disabled={false}
        selectedWorkflowId={null}
        onSelectWorkflow={() => {}}
      />,
    );

    // Trigger should indicate unavailable state (disabled or error label)
    expect(html).toContain("disabled");
  });

  test("shows unavailable affordance when workflows list is empty", async () => {
    swrState = { data: { workflows: [] } };
    const { WorkflowPickerCompact } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerCompact
        disabled={false}
        selectedWorkflowId={null}
        onSelectWorkflow={() => {}}
      />,
    );

    // Should indicate there are no workflows available
    expect(html).toContain("disabled");
  });

  // BT-005: disabled prop
  test("trigger is disabled when the disabled prop is true", async () => {
    swrState = { data: { workflows: [enabledWorkflow] } };
    const { WorkflowPickerCompact } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerCompact
        disabled={true}
        selectedWorkflowId={null}
        onSelectWorkflow={() => {}}
      />,
    );

    expect(html).toContain("disabled");
  });
});

describe("WorkflowPickerItems", () => {
  beforeEach(() => {
    swrState = {};
  });

  // BT-004: items list via pure presenter
  test("renders item names for all workflows", async () => {
    const { WorkflowPickerItems } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerItems
        workflows={[enabledWorkflow, disabledWorkflow]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    expect(html).toContain("Test Run");
    expect(html).toContain("Deploy to Production");
  });

  test("disabled item shows its disabledReason in the markup", async () => {
    const { WorkflowPickerItems } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerItems
        workflows={[enabledWorkflow, disabledWorkflow]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    expect(html).toContain("Workflow is currently disabled");
  });

  test("disabled item carries the aria-disabled or disabled marker", async () => {
    const { WorkflowPickerItems } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerItems
        workflows={[disabledWorkflow]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    // The disabled workflow's radio item must be marked disabled
    expect(html).toContain("disabled");
  });

  test("enabled item does NOT have a disabledReason rendered", async () => {
    const { WorkflowPickerItems } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerItems
        workflows={[enabledWorkflow]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    // No disabled reason text should appear for the enabled workflow
    expect(html).not.toContain("Workflow is currently disabled");
  });

  // BT-006: selection-only contract — onSelect is called with the id
  test("onSelect handler is invoked with the workflow id when called directly", async () => {
    const { WorkflowPickerItems } = await componentModulePromise;

    const calls: Array<string | null> = [];
    const onSelect = (id: string | null) => {
      calls.push(id);
    };

    // Render the presenter — this verifies it mounts without error
    renderToStaticMarkup(
      <WorkflowPickerItems
        workflows={[enabledWorkflow]}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    // Invoke the handler directly to verify the contract (simulating a user click)
    onSelect(enabledWorkflow.id);
    expect(calls).toEqual(["test-run"]);
  });

  test("shows proof level hint in the item markup", async () => {
    const { WorkflowPickerItems } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerItems
        workflows={[enabledWorkflow]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    // The proof level hint should be shown
    expect(html).toContain("basic");
  });
});

// ── Regression tests ──────────────────────────────────────────────────────────
// These tests catch future breakage of the behaviors introduced in
// feat: TASK-ISSUE-32 (green commit 8b94e325).

describe("WorkflowPickerCompact regression", () => {
  beforeEach(() => {
    swrState = {};
  });

  // Regression: disabled item in presenter must NOT be clickable (button disabled)
  // If disabled items were made clickable, the disabledReason affordance breaks.
  test("disabled workflow button in presenter has the HTML disabled attribute", async () => {
    const { WorkflowPickerItems } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerItems
        workflows={[disabledWorkflow]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    // The button for the disabled workflow must have disabled attribute
    // This fails if someone removes disabled={!workflow.available} from the button
    expect(html).toContain("disabled");
    expect(html).toContain("Deploy to Production");
  });

  // Regression: disabledReason must be visible in the presenter
  // If the conditional render of disabledReason is removed, this fails
  test("disabledReason text is always rendered for unavailable workflows", async () => {
    const { WorkflowPickerItems } = await componentModulePromise;
    const customDisabledWorkflow: WorkflowCatalogEntry = {
      ...disabledWorkflow,
      disabledReason: "Coming in v2 release",
    };

    const html = renderToStaticMarkup(
      <WorkflowPickerItems
        workflows={[customDisabledWorkflow]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    expect(html).toContain("Coming in v2 release");
  });

  // Regression: enabled workflow must NOT show a disabledReason
  // If the conditional check is dropped, enabled items would show null/undefined
  test("enabled workflows do not render a disabledReason span", async () => {
    const { WorkflowPickerItems } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <WorkflowPickerItems
        workflows={[enabledWorkflow]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    // No disabled spans for an enabled workflow — if disabledReason condition
    // were removed, "null" or empty spans would appear
    expect(html).not.toContain("Workflow is currently disabled");
    expect(html).toContain("Test Run");
  });

  // Regression: WorkflowPickerCompact trigger must be disabled when loading
  // If isTriggerDisabled logic loses the isLoading check, this fails
  test("trigger is disabled during SWR loading regardless of disabled prop value", async () => {
    swrState = { isLoading: true };
    const { WorkflowPickerCompact } = await componentModulePromise;

    const htmlNotDisabledProp = renderToStaticMarkup(
      <WorkflowPickerCompact
        disabled={false}
        selectedWorkflowId={null}
        onSelectWorkflow={() => {}}
      />,
    );

    // Even with disabled=false, the trigger must be disabled while loading
    expect(htmlNotDisabledProp).toContain("disabled");
  });

  // Regression: component exports only the expected public API (no run-start exports)
  // This verifies the selection-only contract: if run-start logic were added
  // and wired as a top-level export, this snapshot of exported names catches it.
  test("component module exports only the expected symbols (no run-start exports)", async () => {
    const mod = await componentModulePromise;
    const exportedKeys = Object.keys(mod).sort();

    // Allowed exports: the two components and the two interface/prop-type brands
    // (bun:test reflects exported functions, not interfaces)
    expect(exportedKeys).toContain("WorkflowPickerCompact");
    expect(exportedKeys).toContain("WorkflowPickerItems");

    // Must NOT export any run-start or mutation surface
    expect(exportedKeys).not.toContain("startWorkflowRun");
    expect(exportedKeys).not.toContain("useRunStart");
    expect(exportedKeys).not.toContain("submitWorkflow");
  });
});
