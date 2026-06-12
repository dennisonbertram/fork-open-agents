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
  // BT-FORM-001: repoOwner and repoName props pre-populate fields
  test("BT-FORM-001: when initialRepoOwner and initialRepoName are provided, fields are pre-populated", async () => {
    const { LoopCreateForm } = await formModulePromise;

    const html = renderToStaticMarkup(
      <LoopCreateForm initialRepoOwner="myorg" initialRepoName="myrepo" />,
    );

    // The repo owner and repo name fields should have the prefilled values
    expect(html).toContain('value="myorg"');
    expect(html).toContain('value="myrepo"');
  });

  // BT-FORM-002: without prefill props, fields are empty (existing behavior)
  test("BT-FORM-002: when no prefill props provided, repo fields start empty", async () => {
    const { LoopCreateForm } = await formModulePromise;

    const html = renderToStaticMarkup(<LoopCreateForm />);

    // Fields should not have pre-populated values
    expect(html).not.toContain('value="myorg"');
    expect(html).not.toContain('value="myrepo"');
    // Repo fields exist but empty
    expect(html).toContain('id="repo-owner"');
    expect(html).toContain('id="repo-name"');
  });
});
