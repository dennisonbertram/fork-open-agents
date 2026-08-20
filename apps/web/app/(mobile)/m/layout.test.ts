import { beforeEach, describe, expect, mock, test } from "bun:test";

const redirect = mock((path: string) => {
  throw new Error(`redirect:${path}`);
});
let invokePath: string | null = null;
let serverSession: { user: { id: string } } | null = null;

mock.module("next/navigation", () => ({ redirect }));
mock.module("next/headers", () => ({
  headers: async () => {
    const requestHeaders = new Headers();
    if (invokePath) {
      requestHeaders.set("x-invoke-path", invokePath);
    }
    return requestHeaders;
  },
}));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => serverSession,
}));

const layoutModulePromise = import("./layout");

describe("MobileLayout", () => {
  beforeEach(() => {
    invokePath = null;
    serverSession = null;
    redirect.mockClear();
  });

  test("redirects signed-out users back to a mobile chat deep link", async () => {
    invokePath = "/m/chat/some-id";
    const { default: MobileLayout } = await layoutModulePromise;

    await expect(MobileLayout({ children: "protected" })).rejects.toThrow(
      "redirect:/?next=%2Fm%2Fchat%2Fsome-id",
    );
  });

  test("preserves and encodes a mobile deep link query string", async () => {
    invokePath = "/m/chat/some-id?source=shared&view=compact";
    const { default: MobileLayout } = await layoutModulePromise;

    await expect(MobileLayout({ children: "protected" })).rejects.toThrow(
      "redirect:/?next=%2Fm%2Fchat%2Fsome-id%3Fsource%3Dshared%26view%3Dcompact",
    );
  });

  test("redirects signed-out users to the landing page without a request path", async () => {
    const { default: MobileLayout } = await layoutModulePromise;

    await expect(MobileLayout({ children: "protected" })).rejects.toThrow(
      "redirect:/",
    );
  });
});
