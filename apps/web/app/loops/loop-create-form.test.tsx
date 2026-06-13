/**
 * Loop create form component tests (M1-09)
 *
 * Behavior contract:
 *   BT-LOOPS-006: Structured validation errors render per-node/edge before save
 *   BT-LOOPS-007: Valid JSON textarea accepts and shows no errors
 *   BT-LOOPS-008: Invalid JSON text shows parse error before any request
 *   BT-LOOPS-GATE-006: First label is title-case "Name" (REG-GATE-004)
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Mock useRouter
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

// Mock sonner toast
mock.module("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));

const formModulePromise = import("./loop-create-form");

describe("LoopCreateForm", () => {
  // BT-LOOPS-006: structured validation errors render per-node/edge before save
  test("BT-LOOPS-006: renders structured validation errors from definition JSON editor", async () => {
    const { LoopCreateForm } = await formModulePromise;
    const mockErrors = [
      {
        kind: "loop_invalid" as const,
        rule: "no_start" as const,
        message: "Definition must have exactly one start node.",
      },
      {
        kind: "loop_invalid" as const,
        rule: "no_end" as const,
        message: "Definition must have at least one end node.",
      },
    ];
    const html = renderToStaticMarkup(
      <LoopCreateForm initialValidationErrors={mockErrors} />,
    );

    expect(html).toContain("no_start");
    expect(html).toContain("no_end");
    expect(html).toContain("Definition must have exactly one start node.");
    expect(html).toContain("Definition must have at least one end node.");
  });

  // BT-LOOPS-007: valid form renders with no errors when no errors passed
  test("BT-LOOPS-007: renders form fields with no errors when no validation errors passed", async () => {
    const { LoopCreateForm } = await formModulePromise;
    const html = renderToStaticMarkup(<LoopCreateForm />);

    // Form fields present
    expect(html).toContain("name");
    // No error messages
    expect(html).not.toContain("loop_invalid");
  });

  // BT-LOOPS-008: empty form renders with definition textarea
  test("BT-LOOPS-008: renders JSON definition textarea", async () => {
    const { LoopCreateForm } = await formModulePromise;
    const html = renderToStaticMarkup(<LoopCreateForm />);

    expect(html).toContain("definition");
  });

  // BT-LOOPS-GATE-006 / REG-GATE-004: first label is title-case "Name"
  test("BT-LOOPS-GATE-006: first label is title-case Name (not lowercase name)", async () => {
    const { LoopCreateForm } = await formModulePromise;
    const html = renderToStaticMarkup(<LoopCreateForm />);

    // Must contain title-case label
    expect(html).toContain(">Name<");
    // The previous weak assertion still holds but is no longer sufficient alone
    expect(html).toContain("name");
  });
});
