import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user-1" } }),
}));

const pageModulePromise = import("./page");

describe("GtmResearchPage", () => {
  test("renders the authenticated GTM research work surface", async () => {
    const { default: GtmResearchPage } = await pageModulePromise;

    const html = renderToStaticMarkup(await GtmResearchPage());

    expect(html).toContain("GTM research");
    expect(html).toContain("Run research");
    expect(html).toContain("Research claims");
  });
});
