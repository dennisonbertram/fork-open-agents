import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import RepositoriesLoading from "./loading";

describe("Repositories loading", () => {
  test("keeps stable heading and list-card geometry", () => {
    const html = renderToStaticMarkup(<RepositoriesLoading />);
    expect(html).toContain("Repositories");
    expect(html).toContain('aria-label="Loading repositories"');
    expect(html.match(/data-repository-skeleton/g)?.length).toBe(3);
  });
});
