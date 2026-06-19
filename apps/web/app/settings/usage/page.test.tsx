import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Mock the heavy data-fetching section so we test page composition, not data.
mock.module("../usage-section", () => ({
  UsageSection: () => <div>USAGE_SECTION_STUB</div>,
}));

describe("Usage page", () => {
  test("is a real page (no redirect) that hosts the usage section under a header", async () => {
    // A redirect() page throws during render; reaching the assertions proves
    // this is now a real, composed page.
    const { default: UsagePage } = await import("./page");
    const html = renderToStaticMarkup(<UsagePage />);
    expect(html).toContain("Usage");
    expect(html).toContain("USAGE_SECTION_STUB");
  });
});
