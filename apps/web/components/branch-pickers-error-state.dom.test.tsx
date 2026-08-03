/**
 * Regression: branch pickers must not report a failed /api/github/branches
 * fetch as "No branches found." (#1090)
 *
 * BT-BP-001: BranchSelectorCompact — SWR error renders load-failure copy plus
 *            a Retry control, and does NOT render "No branches found."
 * BT-BP-002: BranchSelectorCompact — genuine empty list renders no failure
 *            copy and no Retry control. (cmdk's CommandEmpty does not resolve
 *            inside the Radix popover under happy-dom, so the literal
 *            "No branches found." copy is asserted on the dialog in BT-BP-004;
 *            here we assert the failure state is absent, which is the property
 *            that makes the two states distinguishable.)
 * BT-BP-003: BranchPickerDialog — SWR error renders load-failure copy plus a
 *            Retry control, and does NOT render "No branches found."
 * BT-BP-004: BranchPickerDialog — genuine empty list still renders
 *            "No branches found." and no Retry control.
 */

import {
  act,
  registerDomTestHooks,
  render,
  userClick,
  waitFor,
  within,
} from "@/tests/dom";
import { describe, expect, mock, test } from "bun:test";

type SwrState = {
  data: { branches: string[]; defaultBranch: string } | undefined;
  error: Error | undefined;
};

let swrState: SwrState = { data: undefined, error: undefined };
const mutateCalls: number[] = [];

mock.module("swr", () => ({
  default: () => ({
    data: swrState.data,
    error: swrState.error,
    isLoading: false,
    isValidating: false,
    mutate: () => {
      mutateCalls.push(1);
      return Promise.resolve(undefined);
    },
  }),
}));

const { BranchSelectorCompact } = await import("./branch-selector-compact");
const { BranchPickerDialog } = await import("./branch-picker-dialog");

registerDomTestHooks();

async function renderCompact() {
  const view = render(
    <BranchSelectorCompact
      isNewBranch={false}
      onChange={() => {}}
      owner="acme"
      repo="widgets"
      value={null}
    />,
  );
  await userClick(within(view.baseElement).getByRole("button"));
  // cmdk resolves its filtered/empty state on a follow-up render pass.
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

function renderDialog() {
  return render(
    <BranchPickerDialog
      isCreating={false}
      onOpenChange={() => {}}
      onSelectBranch={() => {}}
      open={true}
      owner="acme"
      repo="widgets"
    />,
  );
}

describe("branch pickers distinguish a failed fetch from an empty repo (#1090)", () => {
  test("BT-BP-001 compact selector surfaces the load failure with retry", async () => {
    swrState = { data: undefined, error: new Error("Bad credentials") };
    mutateCalls.length = 0;

    const { baseElement } = await renderCompact();
    await waitFor(() => {
      expect(baseElement.textContent ?? "").toContain("Couldn't load branches");
    });
    expect(baseElement.textContent ?? "").not.toContain("No branches found");

    const retry = within(baseElement).getByRole("button", { name: /retry/i });
    await userClick(retry);
    expect(mutateCalls.length).toBeGreaterThan(0);
  });

  test("BT-BP-002 compact selector keeps the genuine empty state", async () => {
    swrState = {
      data: { branches: [], defaultBranch: "main" },
      error: undefined,
    };

    const { baseElement } = await renderCompact();
    expect(baseElement.textContent ?? "").not.toContain(
      "Couldn't load branches",
    );
    expect(
      within(baseElement).queryByRole("button", { name: /retry/i }),
    ).toBeNull();
  });

  test("BT-BP-003 picker dialog surfaces the load failure with retry", async () => {
    swrState = { data: undefined, error: new Error("Bad credentials") };
    mutateCalls.length = 0;

    const { baseElement } = renderDialog();
    const text = baseElement.textContent ?? "";

    expect(text).toContain("Couldn't load branches");
    expect(text).not.toContain("No branches found");

    const retry = within(baseElement).getByRole("button", { name: /retry/i });
    await userClick(retry);
    expect(mutateCalls.length).toBeGreaterThan(0);
  });

  test("BT-BP-005 picker dialog keeps cached branches when a revalidation fails", async () => {
    swrState = {
      data: { branches: ["main", "feature/x"], defaultBranch: "main" },
      error: new Error("Failed to fetch"),
    };
    mutateCalls.length = 0;

    const { baseElement } = renderDialog();
    const text = baseElement.textContent ?? "";

    expect(text).toContain("feature/x");
    expect(text).toContain("Couldn't refresh branches");

    const retry = within(baseElement).getByRole("button", { name: /retry/i });
    await userClick(retry);
    expect(mutateCalls.length).toBeGreaterThan(0);
  });

  test("BT-BP-006 compact selector keeps cached branches and label when a revalidation fails", async () => {
    swrState = {
      data: { branches: ["main", "feature/x"], defaultBranch: "main" },
      error: new Error("Failed to fetch"),
    };

    const { baseElement } = await renderCompact();
    const text = baseElement.textContent ?? "";

    expect(text).toContain("feature/x");
    expect(text).not.toContain("Branches unavailable");
    expect(text).toContain("Couldn't refresh branches");
  });

  test("BT-BP-004 picker dialog keeps the genuine empty state", () => {
    swrState = {
      data: { branches: [], defaultBranch: "main" },
      error: undefined,
    };

    const { baseElement } = renderDialog();
    const text = baseElement.textContent ?? "";

    expect(text).toContain("No branches found");
    expect(text).not.toContain("Couldn't load branches");
    expect(
      within(baseElement).queryByRole("button", { name: /retry/i }),
    ).toBeNull();
  });
});
