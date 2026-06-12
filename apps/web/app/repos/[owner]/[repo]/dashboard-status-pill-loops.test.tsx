/**
 * DashboardStatusPill loop-status extension tests (M2-05 / #361)
 *
 * Behavior contract:
 *   BT-PILL-001: active status → emerald color class
 *   BT-PILL-002: paused status → amber color class
 *   BT-PILL-003: draft status → neutral (muted/border) color class
 *   BT-PILL-004: archived status → muted color class
 *   BT-PILL-005: existing statuses (succeeded, failed, running) still work
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardStatusPill } from "./dashboard-status-pill";

describe("DashboardStatusPill — loop status extension", () => {
  // BT-PILL-001: active → emerald
  test("BT-PILL-001: active status renders with emerald color classes", () => {
    const html = renderToStaticMarkup(<DashboardStatusPill status="active" />);

    expect(html).toContain("active");
    expect(html).toContain("emerald");
  });

  // BT-PILL-002: paused → amber
  test("BT-PILL-002: paused status renders with amber color classes", () => {
    const html = renderToStaticMarkup(<DashboardStatusPill status="paused" />);

    expect(html).toContain("paused");
    expect(html).toContain("amber");
  });

  // BT-PILL-003: draft → neutral (no emerald, no amber, no red)
  test("BT-PILL-003: draft status renders with neutral (muted) color classes", () => {
    const html = renderToStaticMarkup(<DashboardStatusPill status="draft" />);

    expect(html).toContain("draft");
    // draft should NOT be emerald, amber, or red
    expect(html).not.toContain("emerald");
    expect(html).not.toContain("amber");
    expect(html).not.toContain("red-500");
  });

  // BT-PILL-004: archived → muted (no emerald, no amber, no red)
  test("BT-PILL-004: archived status renders with muted color classes", () => {
    const html = renderToStaticMarkup(<DashboardStatusPill status="archived" />);

    expect(html).toContain("archived");
    expect(html).not.toContain("emerald");
    expect(html).not.toContain("amber");
    expect(html).not.toContain("red-500");
  });

  // BT-PILL-005: existing statuses remain unchanged
  test("BT-PILL-005: existing status mappings (succeeded, failed, running) still work", () => {
    const succeededHtml = renderToStaticMarkup(
      <DashboardStatusPill status="succeeded" />,
    );
    const failedHtml = renderToStaticMarkup(
      <DashboardStatusPill status="failed" />,
    );
    const runningHtml = renderToStaticMarkup(
      <DashboardStatusPill status="running" />,
    );

    expect(succeededHtml).toContain("emerald");
    expect(failedHtml).toContain("red");
    expect(runningHtml).toContain("amber");
  });
});
