import { describe, expect, test } from "bun:test";
import { normalizeRepository } from "./repositories";

describe("agent API repository policy", () => {
  test("allows empty-workspace runs without evaluating allowlists", () => {
    const result = normalizeRepository(undefined, {
      allowedRepositories: ["acme/widgets"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repository).toBeNull();
    }
  });

  test("derives clone URLs and defaults newBranch to true", () => {
    const result = normalizeRepository(
      { owner: "acme", name: "widgets" },
      { allowedRepositories: null },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repository).toMatchObject({
        owner: "acme",
        name: "widgets",
        cloneUrl: "https://github.com/acme/widgets.git",
        newBranch: true,
      });
    }
  });

  test("rejects repo allowlist misses before sandbox work can start", () => {
    const result = normalizeRepository(
      { owner: "acme", name: "other" },
      { allowedRepositories: ["acme/widgets"] },
    );

    expect(result).toMatchObject({
      ok: false,
      status: 403,
      code: "repository_not_allowed",
    });
  });

  test("requires explicit clone URLs to match owner and name", () => {
    const result = normalizeRepository(
      {
        owner: "acme",
        name: "widgets",
        cloneUrl: "https://github.com/acme/other.git",
      },
      { allowedRepositories: null },
    );

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "clone_url_mismatch",
    });
  });
});
