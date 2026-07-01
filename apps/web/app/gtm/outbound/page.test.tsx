import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user-1" } }),
}));

const pageModulePromise = import("./page");

describe("GtmOutboundPage", () => {
  test("renders the authenticated GTM outbound work surface", async () => {
    const { default: GtmOutboundPage } = await pageModulePromise;

    const html = renderToStaticMarkup(await GtmOutboundPage());

    expect(html).toContain("GTM outbound");
    expect(html).toContain("Create approval");
    expect(html).toContain("Recipient domain");
  });
});
