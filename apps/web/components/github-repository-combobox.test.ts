import { describe, expect, test } from "bun:test";
import { parseGitHubRepositorySlug } from "./github-repository-combobox";

describe("parseGitHubRepositorySlug", () => {
  test("parses an owner/repository slug", () => {
    expect(parseGitHubRepositorySlug("acme/widgets")).toEqual({
      owner: "acme",
      name: "widgets",
    });
  });

  test("trims surrounding whitespace and slashes", () => {
    expect(parseGitHubRepositorySlug("  /acme/widgets/ ")).toEqual({
      owner: "acme",
      name: "widgets",
    });
  });

  test("rejects incomplete or nested repository paths", () => {
    expect(parseGitHubRepositorySlug("acme")).toBeNull();
    expect(parseGitHubRepositorySlug("/widgets")).toBeNull();
    expect(parseGitHubRepositorySlug("acme/")).toBeNull();
    expect(parseGitHubRepositorySlug("acme/widgets/extra")).toBeNull();
  });
});
