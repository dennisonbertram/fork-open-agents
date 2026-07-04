/**
 * loop-settings-panel-component.tsx copy tests (#768)
 *
 * Behavior contract:
 *   BT-LSP-001: "Guardrails" section header reads "Safety limits" with a
 *               one-line explanation under it (jargon-free naive-user pass).
 *   BT-LSP-002: "Watchdog" section header reads "Auto-recovery (watchdog)"
 *               with a one-line explanation under it.
 *
 * #877: LoopSettingsPanelContent is now store-backed (settings live in the
 * shared builder store, not local useState). These SSR copy assertions only
 * check static section labels, so they're unaffected by the store swap.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoopSettingsPanelContent } from "./loop-settings-panel-component";
import { createLoopBuilderStore } from "./use-loop-builder";

function renderContent() {
  const store = createLoopBuilderStore();
  return renderToStaticMarkup(
    <LoopSettingsPanelContent store={store} onClose={() => undefined} />,
  );
}

describe("LoopSettingsPanelContent — jargon-free section headers (#768)", () => {
  test("BT-LSP-001: Guardrails section reads 'Safety limits' with an explanation", () => {
    const html = renderContent();

    expect(html).toContain("Safety limits");
    // The bare jargon term must not appear as a standalone header anymore.
    expect(html).not.toMatch(/>Guardrails</);
    // A one-line explanation must accompany the header.
    expect(html).toMatch(/limits? (on|that) (how long|what)/i);
  });

  test("BT-LSP-002: Watchdog section reads 'Auto-recovery (watchdog)' with an explanation", () => {
    const html = renderContent();

    expect(html).toContain("Auto-recovery (watchdog)");
    expect(html).not.toMatch(/>Watchdog</);
  });

  test("BT-LSP-003: Safety limits section renders the Agent turns per step field (#862)", () => {
    const html = renderContent();

    expect(html).toContain("Agent turns per step");
  });
});
