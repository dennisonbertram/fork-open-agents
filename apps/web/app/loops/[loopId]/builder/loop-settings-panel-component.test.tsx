/**
 * loop-settings-panel-component.tsx copy tests (#768)
 *
 * Behavior contract:
 *   BT-LSP-001: "Guardrails" section header reads "Safety limits" with a
 *               one-line explanation under it (jargon-free naive-user pass).
 *   BT-LSP-002: "Watchdog" section header reads "Auto-recovery (watchdog)"
 *               with a one-line explanation under it.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoopSettingsPanelContent } from "./loop-settings-panel-component";

describe("LoopSettingsPanelContent — jargon-free section headers (#768)", () => {
  test("BT-LSP-001: Guardrails section reads 'Safety limits' with an explanation", () => {
    const html = renderToStaticMarkup(
      <LoopSettingsPanelContent
        loopId="loop_1"
        initialName="My loop"
        onClose={() => undefined}
      />,
    );

    expect(html).toContain("Safety limits");
    // The bare jargon term must not appear as a standalone header anymore.
    expect(html).not.toMatch(/>Guardrails</);
    // A one-line explanation must accompany the header.
    expect(html).toMatch(/limits? (on|that) (how long|what)/i);
  });

  test("BT-LSP-002: Watchdog section reads 'Auto-recovery (watchdog)' with an explanation", () => {
    const html = renderToStaticMarkup(
      <LoopSettingsPanelContent
        loopId="loop_1"
        initialName="My loop"
        onClose={() => undefined}
      />,
    );

    expect(html).toContain("Auto-recovery (watchdog)");
    expect(html).not.toMatch(/>Watchdog</);
  });
});
