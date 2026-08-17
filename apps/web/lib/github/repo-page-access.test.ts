import { describe, expect, test } from "bun:test";
import { resolveRepoAccessPageOutcome } from "./repo-page-access";

// Review finding on #1326: both repo pages answered every denial with a 404.
// A user whose GitHub token had expired was told the repository did not exist,
// with no route back to reconnecting — a wrong answer, confidently given.
describe("repo page access outcome", () => {
  test("a broken or absent connection is actionable, not a 404", () => {
    expect(resolveRepoAccessPageOutcome("no_user_token")).toBe("actionable");
    expect(resolveRepoAccessPageOutcome("user_token_rejected")).toBe(
      "actionable",
    );
  });

  test("rate limiting is actionable — it resolves on its own", () => {
    expect(resolveRepoAccessPageOutcome("rate_limited")).toBe("actionable");
  });

  test("a missing or too-narrow App installation is actionable", () => {
    expect(resolveRepoAccessPageOutcome("no_installation")).toBe("actionable");
    expect(resolveRepoAccessPageOutcome("app_no_access")).toBe("actionable");
  });

  test("genuinely having no access to the repo is a 404", () => {
    // Nothing the user can do in this app changes these, and revealing that
    // the repo exists would leak its existence.
    expect(resolveRepoAccessPageOutcome("user_no_access")).toBe("not_found");
    expect(resolveRepoAccessPageOutcome("user_no_write")).toBe("not_found");
  });
});
