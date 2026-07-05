/**
 * RunMetadataTable — terminal-style label/value row list (#895).
 *
 * Bug: run metadata (loop run + background run detail pages) rendered as
 * `ProofItem` cards in a content-sized responsive grid. Long values (workflow
 * run ids, UUID request ids, idempotency keys) made cells uneven, so the grid
 * re-packed — and it shifted again on every poll as values changed. This
 * component replaces that grid with a single bordered container of aligned
 * `label  value` rows: a fixed-width label column independent of value
 * length, and each value living in its own `overflow-x-auto` cell so long
 * strings scroll within the cell instead of widening the row or shifting
 * siblings.
 *
 * Row-set stability contract (encoded here per #895's "pick one"): a
 * not-yet-known value (null) still renders its row, showing a "—"
 * placeholder, rather than the row appearing/disappearing.
 */

import { registerDomTestHooks, render, within } from "@/tests/dom";

import { describe, expect, test } from "bun:test";
import { RunMetadataTable, type RunMetadataRow } from "./run-metadata-table";

registerDomTestHooks();

const SHORT_WORKFLOW_RUN_ID = "wr_1";
const LONG_WORKFLOW_RUN_ID = "wrun_01KWNBP9FHXHQ4YE77GBX0C1VP4Z9Q2X7K3M5N6";
const LONG_IDEMPOTENCY_KEY =
  "loop_9c3d5f6a7b8c-idempotency-2994ac80-9e66-4558-8c1c-81128e52c26d";

function baseRows(workflowRunId: string | null): RunMetadataRow[] {
  return [
    { key: "status", label: "Status", value: "failed" },
    { key: "source", label: "Source", value: "manual" },
    {
      key: "workflow-run",
      label: "Workflow Run",
      value: workflowRunId,
      copyable: true,
    },
    { key: "request-id", label: "Request ID", value: null, copyable: true },
  ];
}

describe("RunMetadataTable (#895)", () => {
  test("label column structure is identical whether the Workflow Run value is short or long", () => {
    const { container: shortContainer } = render(
      <RunMetadataTable rows={baseRows(SHORT_WORKFLOW_RUN_ID)} />,
    );
    const shortLabel = within(shortContainer).getByText("Workflow Run");
    const shortRow = shortLabel.closest("[data-row-key]");

    const { container: longContainer } = render(
      <RunMetadataTable rows={baseRows(LONG_WORKFLOW_RUN_ID)} />,
    );
    const longLabel = within(longContainer).getByText("Workflow Run");
    const longRow = longLabel.closest("[data-row-key]");

    // The label cell's className (which carries the fixed-width utility
    // classes) must not depend on the sibling value's length — this is what
    // "the label column is fixed and independent of value length" means
    // structurally, since happy-dom has no layout engine to measure real
    // pixel widths.
    expect(longLabel.className).toBe(shortLabel.className);
    expect(longRow?.className).toBe(shortRow?.className);
  });

  test("a long Workflow Run value lives in an overflow-x-auto cell, not a content-sized one", () => {
    const { container } = render(
      <RunMetadataTable rows={baseRows(LONG_WORKFLOW_RUN_ID)} />,
    );
    const value = within(container).getByText(LONG_WORKFLOW_RUN_ID);

    expect(value.className).toContain("overflow-x-auto");
    // Must not use `truncate` (the old ProofItem behavior that hid the tail
    // of long ids instead of containing them in a scrollable cell).
    expect(value.className).not.toContain("truncate");
  });

  test("copy control renders for the Workflow Run row", () => {
    const { container } = render(
      <RunMetadataTable rows={baseRows(SHORT_WORKFLOW_RUN_ID)} />,
    );
    const q = within(container);

    expect(
      q.getByRole("button", { name: "Copy Workflow Run" }),
    ).toBeTruthy();
  });

  test("copy control renders for a Request ID row once a value exists", () => {
    const { container } = render(
      <RunMetadataTable
        rows={[
          {
            key: "request-id",
            label: "Request ID",
            value: "2994ac80-9e66-4558-8c1c-81128e52c26d",
            copyable: true,
          },
        ]}
      />,
    );
    const q = within(container);

    expect(q.getByRole("button", { name: "Copy Request ID" })).toBeTruthy();
  });

  test("a copyable row with no value yet renders the placeholder and no copy button", () => {
    const { container } = render(
      <RunMetadataTable rows={baseRows(SHORT_WORKFLOW_RUN_ID)} />,
    );
    const q = within(container);

    // Request ID row is present (stable row set) …
    expect(q.getByText("Request ID")).toBeTruthy();
    // … with a placeholder, not omitted …
    expect(q.getByText("—")).toBeTruthy();
    // … and no copy button for a value that doesn't exist yet.
    expect(q.queryByRole("button", { name: "Copy Request ID" })).toBeNull();
  });

  test("a long Idempotency Key value lives in a non-reflowing overflow-x-auto cell", () => {
    const { container } = render(
      <RunMetadataTable
        rows={[
          {
            key: "idempotency-key",
            label: "Idempotency Key",
            value: LONG_IDEMPOTENCY_KEY,
          },
        ]}
      />,
    );
    const value = within(container).getByText(LONG_IDEMPOTENCY_KEY);

    expect(value.className).toContain("overflow-x-auto");
  });

  test("renders an optional heading and a single bordered container", () => {
    const { container } = render(
      <RunMetadataTable heading="Correlation IDs" rows={baseRows(null)} />,
    );
    const q = within(container);

    expect(q.getByText("Correlation IDs")).toBeTruthy();
    // One bordered container wraps everything — not N separate card borders.
    expect(container.querySelectorAll(".border.border-border").length).toBe(
      1,
    );
  });
});
