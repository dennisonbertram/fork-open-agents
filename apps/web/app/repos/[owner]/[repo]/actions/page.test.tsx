import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let userId: string | null = "user-1";
const redirect = mock((_path: string) => {
  throw new Error("redirect");
});
const renderClient = mock((_owner: string, _repo: string) => undefined);

mock.module("next/navigation", () => ({ redirect }));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => (userId ? { user: { id: userId } } : null),
}));
mock.module("./actions-dashboard-client", () => ({
  ActionsDashboardClient: ({
    owner,
    repo,
  }: {
    owner: string;
    repo: string;
  }) => {
    renderClient(owner, repo);
    return (
      <div>
        ACTIONS_CLIENT:{owner}/{repo}
      </div>
    );
  },
}));

const pageModulePromise = import("./page");

describe("legacy repository Actions compatibility", () => {
  beforeEach(() => {
    userId = "user-1";
    redirect.mockClear();
    renderClient.mockClear();
  });

  test("retains authenticated direct access with repository coordinates", async () => {
    const { default: ActionsPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await ActionsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );
    expect(html).toContain("ACTIONS_CLIENT:acme/widgets");
    expect(renderClient).toHaveBeenCalledWith("acme", "widgets");
  });

  test("authenticates before rendering the legacy provider client", async () => {
    userId = null;
    const { default: ActionsPage } = await pageModulePromise;
    await expect(
      ActionsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    ).rejects.toThrow("redirect");
    expect(redirect).toHaveBeenCalledWith("/");
    expect(renderClient).not.toHaveBeenCalled();
  });
});
