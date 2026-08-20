import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

describe("SessionNotFound", () => {
  test("renders a designed missing-session boundary", async () => {
    const { default: SessionNotFound } = await import("./not-found");
    const html = renderToStaticMarkup(<SessionNotFound />);

    expect(html).toContain("Session not found");
    expect(html).toContain("This session may have been archived or deleted.");
    expect(html).toContain('href="/sessions"');
    expect(html).not.toContain("useSessionLayout");
  });
});

// Placement guard. A not-found.tsx inside `[sessionId]/` sits BELOW that
// segment's layout, and `layout.tsx` is what throws notFound() for a deleted
// session — so a boundary nested there can never catch the common case, and a
// direct-render test cannot see the difference. The first version of this file
// was nested that way. Keep it above the layout.
describe("boundary placement", () => {
  test("lives above the [sessionId] layout that throws notFound", async () => {
    const here = new URL(".", import.meta.url).pathname;
    expect(here.endsWith("/app/sessions/")).toBe(true);

    const layout = await Bun.file(
      new URL("[sessionId]/layout.tsx", import.meta.url).pathname,
    ).text();
    expect(layout).toContain("notFound()");
  });
});
