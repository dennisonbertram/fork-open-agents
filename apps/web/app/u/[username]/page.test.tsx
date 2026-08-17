import { beforeEach, describe, expect, mock, test } from "bun:test";

const permanentRedirect = mock((href: string): never => {
  throw new Error(`permanent-redirect:${href}`);
});
const notFound = mock((): never => {
  throw new Error("not-found");
});

mock.module("next/navigation", () => ({ permanentRedirect, notFound }));
mock.module("@/lib/db/public-usage-profile", () => ({
  getPublicUsageProfile: mock(async () => ({ status: "disabled" as const })),
}));

const pageModulePromise = import("./page");

describe("/u/[username] redirect", () => {
  beforeEach(() => {
    permanentRedirect.mockClear();
  });

  test("returns a 308 permanent redirect to /someuser", async () => {
    const { default: Page } = await pageModulePromise;

    await expect(
      Page({
        params: Promise.resolve({ username: "someuser" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("permanent-redirect:/someuser");
    expect(permanentRedirect).toHaveBeenCalledWith("/someuser");
  });
});
