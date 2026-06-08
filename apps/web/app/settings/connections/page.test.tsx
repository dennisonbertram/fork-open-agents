import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Mock heavy async sections so we test page composition, not data.
mock.module("../accounts-section", () => ({
  AccountsSection: () => <div>ACCOUNTS_SECTION_STUB</div>,
  AccountsSectionSkeleton: () => <div>ACCOUNTS_SKELETON_STUB</div>,
}));

mock.module("../vercel-section", () => ({
  VercelSection: () => <div>VERCEL_SECTION_STUB</div>,
  VercelSectionSkeleton: () => <div>VERCEL_SKELETON_STUB</div>,
}));

describe("Connections page", () => {
  test("renders SettingsPageHeader with title and plain-language description", async () => {
    const { default: ConnectionsPage } = await import("./page");
    const html = renderToStaticMarkup(<ConnectionsPage />);
    expect(html).toContain("Connections");
    expect(html).toContain(
      "Link the accounts Open Agents uses to act on your behalf.",
    );
  });
});
