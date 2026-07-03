/**
 * Tests for ComposioToolSelectorCompact's trigger-label selection count
 * (#801, epic #796 T5, finding W6).
 *
 * Before this ticket the trigger button only rendered an icon stack — no
 * text conveyed how many tools were selected, so a screen-reader user (or a
 * sighted user before hovering the title tooltip) had zero indication of the
 * current selection. This is the "trigger label on the chat compact
 * selector" half of W6 (the picker's own checked-state half is covered by
 * composio-toolkit-picker.test.tsx and composio-toolkit-picker-helpers).
 *
 * This repo's test setup has no DOM/testing-library and no DOM environment
 * registered for bun:test (see repo-selector-compact.test.tsx docstring), so
 * this is proven via renderToStaticMarkup against first-paint props — the
 * trigger's accessible label is derived synchronously from props with no
 * effect/interaction required.
 *
 * BT-801-060: with 2 direct toolkit slugs selected, the trigger's accessible
 *             label/title includes "2" so the count is conveyed even without
 *             clicking to open the popover (aria-live-equivalent: exposed via
 *             the persistent aria-label, not just a transient toast).
 * BT-801-061: with zero tools selected, the trigger's accessible label says
 *             so without a stray/incorrect count.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("swr", () => ({
  default: () => ({
    data: {
      profiles: [],
      profileOptions: [],
      status: { configured: true, available: true },
    },
    isLoading: false,
  }),
}));

mock.module("@/app/settings/composio-toolkit-picker", () => ({
  ComposioToolkitPicker: () => null,
}));

const modulePromise = import("./composio-tool-selector-compact");

describe("ComposioToolSelectorCompact — trigger label selection count (W6)", () => {
  test("BT-801-060: 2 selected direct toolkits are reflected in the trigger's accessible label", async () => {
    const { ComposioToolSelectorCompact } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioToolSelectorCompact
        selection={{
          mainProfileId: null,
          directToolkitSlugs: ["gmail", "slack"],
        }}
        onChange={() => {}}
      />,
    );

    expect(html).toContain("2 tools selected");
  });

  test("BT-801-061: zero selected tools does not claim any tools are selected", async () => {
    const { ComposioToolSelectorCompact } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioToolSelectorCompact
        selection={{ mainProfileId: null, directToolkitSlugs: [] }}
        onChange={() => {}}
      />,
    );

    expect(html).not.toContain("tools selected");
  });
});
