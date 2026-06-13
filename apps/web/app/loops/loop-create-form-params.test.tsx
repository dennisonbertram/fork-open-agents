/**
 * LoopCreateForm query-param prefill tests (M2-05 / #361)
 *
 * Behavior contract:
 *   BT-FORM-001: when repoOwner and repoName props are provided, form fields are pre-populated
 *   BT-FORM-002: when no prefill props, fields start empty (existing behavior preserved)
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, back: () => undefined }),
}));

mock.module("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));

const formModulePromise = import("./loop-create-form");

describe("LoopCreateForm query-param prefill", () => {
  // BT-FORM-001: repoOwner and repoName props pre-populate the repo combobox
  test("BT-FORM-001: when initialRepoOwner and initialRepoName are provided, the repo combobox shows owner/repo", async () => {
    const { LoopCreateForm } = await formModulePromise;

    const html = renderToStaticMarkup(
      <LoopCreateForm initialRepoOwner="myorg" initialRepoName="myrepo" />,
    );

    // The combobox trigger should display the prefilled owner/repo slug
    expect(html).toContain("myorg/myrepo");
  });

  // BT-FORM-002: without prefill props, the repo combobox shows its placeholder
  test("BT-FORM-002: when no prefill props provided, the repo combobox is empty (placeholder shown)", async () => {
    const { LoopCreateForm } = await formModulePromise;

    const html = renderToStaticMarkup(<LoopCreateForm />);

    expect(html).not.toContain("myorg/myrepo");
    // Combobox renders its empty placeholder, not a pre-selected repo
    expect(html).toContain("Select a repository");
  });
});
