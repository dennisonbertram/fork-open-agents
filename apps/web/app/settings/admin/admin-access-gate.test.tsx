import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminAccessGate } from "./admin-access-gate";

describe("AdminAccessGate", () => {
  test("explains the area instead of faking a 404", () => {
    const html = renderToStaticMarkup(<AdminAccessGate />);
    expect(html).toContain("Admin tools");
    expect(html).not.toContain("404");
    expect(html).not.toContain("This page could not be found");
  });

  test("offers a way back to settings", () => {
    const html = renderToStaticMarkup(<AdminAccessGate />);
    expect(html).toContain("Back to settings");
    expect(html).toContain('href="/settings/profile"');
  });
});
