import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user-1" } }),
}));

const pageModulePromise = import("./page");

describe("GtmCallsPage", () => {
  test("renders the authenticated GTM calls workspace", async () => {
    const { default: GtmCallsPage } = await pageModulePromise;

    const html = renderToStaticMarkup(await GtmCallsPage());

    expect(html).toContain("GTM calls");
    expect(html).toContain("Create prep");
    expect(html).toContain("Create debrief");
  });
});
