/**
 * Regression for #1089: a FAILED /api/settings/composio fetch must not be
 * reported as "No Composio profiles configured".
 *
 * Before the fix the component dropped SWR's `error`, so a failed fetch left
 * `data` undefined and produced the same output as a successful fetch that
 * returned zero profiles — telling a user with saved profiles, as a statement
 * of fact, that they have none.
 *
 * Same rendering approach as
 * composio-tool-selector-compact-trigger-label.test.tsx: this repo's bun:test
 * setup has no DOM environment, so this asserts on renderToStaticMarkup of the
 * first paint. The trigger's `title` is derived synchronously from props/SWR
 * state, so it is observable without opening the popover.
 *
 * BT-1089-010: fetch failure does not claim there are no profiles.
 * BT-1089-011: fetch failure surfaces a distinct load-failure message.
 * BT-1089-012: the genuine empty state still exists (guards against the fix
 *              collapsing both states into one).
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let swrState: {
  data: unknown;
  isLoading: boolean;
  error?: unknown;
} = {
  data: undefined,
  isLoading: false,
};

mock.module("swr", () => ({
  default: () => ({ ...swrState, mutate: () => {} }),
}));

mock.module("@/app/settings/composio-toolkit-picker", () => ({
  ComposioToolkitPicker: () => null,
}));

const modulePromise = import("./composio-tool-selector-compact");

async function render() {
  const { ComposioToolSelectorCompact } = await modulePromise;
  return renderToStaticMarkup(
    <ComposioToolSelectorCompact
      selection={{ mainProfileId: null, directToolkitSlugs: [] }}
      onChange={() => {}}
    />,
  );
}

describe("ComposioToolSelectorCompact — failed settings load (#1089)", () => {
  test("BT-1089-010: a failed fetch does not claim no profiles are configured", async () => {
    swrState = {
      data: undefined,
      isLoading: false,
      error: new Error("Failed to load Composio settings"),
    };

    expect(await render()).not.toContain("No Composio profiles configured");
  });

  test("BT-1089-011: a failed fetch surfaces a distinct load-failure message", async () => {
    swrState = {
      data: undefined,
      isLoading: false,
      error: new Error("Failed to load Composio settings"),
    };

    expect(await render()).toContain("Couldn't load Composio settings");
  });

  test("BT-1089-012: a successful fetch with zero profiles keeps the genuine empty state", async () => {
    swrState = {
      data: {
        profiles: [],
        profileOptions: [],
        status: { configured: true, available: true },
      },
      isLoading: false,
    };

    const html = await render();
    expect(html).toContain("No Composio profiles configured");
    expect(html).not.toContain("Couldn't load Composio settings");
  });
});
