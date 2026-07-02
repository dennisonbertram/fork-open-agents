import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user-1" } }),
}));

const pageModulePromise = import("./page");

describe("GtmActivationPage", () => {
  test("renders the authenticated GTM activation work surface", async () => {
    const { default: GtmActivationPage } = await pageModulePromise;

    const html = renderToStaticMarkup(await GtmActivationPage());

    expect(html).toContain("GTM activation");
    expect(html).toContain("Run watcher");
    expect(html).toContain("Activation signal queue");
  });
});
