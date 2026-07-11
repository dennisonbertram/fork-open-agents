import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let userId: string | null = "user-1";
const callOrder: string[] = [];
const redirect = mock((_path: string) => {
  throw new Error("redirect");
});
const loadRepositoryDirectory = mock(async (_userId: string) => {
  callOrder.push("load");
  return {
    status: "ready" as const,
    repositories: [
      {
        owner: "acme",
        name: "widgets",
        fullName: "acme/widgets",
        description: null,
        private: true,
        updatedAt: "2026-07-11T00:00:00.000Z",
        language: "TypeScript",
      },
    ],
    installationCount: 1,
    failedInstallationCount: 0,
  };
});

mock.module("next/navigation", () => ({ redirect }));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => {
    callOrder.push("auth");
    return userId ? { user: { id: userId } } : null;
  },
}));
mock.module("@/lib/github/repository-directory", () => ({
  loadRepositoryDirectory,
}));
mock.module("./repository-directory-view", () => ({
  RepositoryDirectoryView: ({ snapshot }: { snapshot: { status: string } }) => (
    <div data-state={snapshot.status}>Repository directory</div>
  ),
}));

const pageModulePromise = import("./page");

describe("ReposPage", () => {
  beforeEach(() => {
    userId = "user-1";
    callOrder.length = 0;
    redirect.mockClear();
    loadRepositoryDirectory.mockClear();
  });

  test("authenticates before loading owner-scoped repositories", async () => {
    const { default: ReposPage } = await pageModulePromise;
    const html = renderToStaticMarkup(await ReposPage());

    expect(callOrder).toEqual(["auth", "load"]);
    expect(loadRepositoryDirectory).toHaveBeenCalledWith("user-1");
    expect(html).toContain("Repository directory");
    expect(redirect).not.toHaveBeenCalled();
  });

  test("redirects before provider reads when signed out", async () => {
    userId = null;
    const { default: ReposPage } = await pageModulePromise;

    await expect(ReposPage()).rejects.toThrow("redirect");
    expect(callOrder).toEqual(["auth"]);
    expect(loadRepositoryDirectory).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
