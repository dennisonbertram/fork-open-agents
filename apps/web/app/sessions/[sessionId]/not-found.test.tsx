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
