import { describe, expect, test } from "bun:test";
import { parseRepoSlug } from "./repo-combobox";

describe("parseRepoSlug", () => {
  test("parses a valid owner/repo", () => {
    expect(parseRepoSlug("acme/widgets")).toEqual({
      owner: "acme",
      name: "widgets",
    });
  });

  test("trims whitespace and surrounding slashes", () => {
    expect(parseRepoSlug("  /acme/widgets/ ")).toEqual({
      owner: "acme",
      name: "widgets",
    });
  });

  test("rejects values without a slash", () => {
    expect(parseRepoSlug("acme")).toBeNull();
    expect(parseRepoSlug("")).toBeNull();
  });

  test("rejects a missing owner or name", () => {
    expect(parseRepoSlug("/widgets")).toBeNull();
    expect(parseRepoSlug("acme/")).toBeNull();
  });

  test("rejects extra path segments (repo names have no slash)", () => {
    expect(parseRepoSlug("acme/widgets/extra")).toBeNull();
  });
});
