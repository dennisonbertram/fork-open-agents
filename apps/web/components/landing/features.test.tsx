import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingFeatures } from "./features";

// Issue #787: the sandbox feature card must not promise universal automatic
// commit/push — `autoCommitPush` defaults to false
// (apps/web/lib/db/schema.ts:2848) and is an opt-in Settings toggle.

describe("LandingFeatures - honest sandbox copy (#787)", () => {
  test("sandbox card does not claim work is committed and pushed automatically", () => {
    const html = renderToStaticMarkup(<LandingFeatures />);
    expect(html).not.toContain("Work is committed and pushed automatically");
  });

  test("sandbox card still communicates ephemeral sandboxes accurately", () => {
    const html = renderToStaticMarkup(<LandingFeatures />);
    expect(html.toLowerCase()).toContain("sandbox");
  });
});
