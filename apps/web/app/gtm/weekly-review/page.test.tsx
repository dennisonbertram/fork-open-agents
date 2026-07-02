import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user-1" } }),
}));

mock.module("next/navigation", () => ({
  redirect: (_url: string) => {
    throw new Error("REDIRECT");
  },
}));

mock.module("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

mock.module("swr", () => ({
  default: () => ({
    data: { learnings: [] },
    error: null,
    isLoading: false,
    mutate: async () => undefined,
  }),
}));

mock.module("sonner", () => ({
  toast: {
    success: () => undefined,
    error: () => undefined,
  },
}));

const pageModulePromise = import("./page");

describe("/gtm/weekly-review page", () => {
  test("renders the weekly review work surface", async () => {
    const { default: GtmWeeklyReviewPage } = await pageModulePromise;
    const html = renderToStaticMarkup(await GtmWeeklyReviewPage());

    expect(html).toContain("GTM weekly review");
    expect(html).toContain("Week start");
    expect(html).toContain("Week end");
    expect(html).toContain("Run review");
    expect(html).toContain("Approved GTM learnings");
    expect(html).toContain("No review run selected");
  });
});
