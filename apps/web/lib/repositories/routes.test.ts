import { describe, expect, test } from "bun:test";
import {
  repositoryAutomationsUrl,
  repositoryDashboardUrl,
  repositoryRunsUrl,
  repositorySettingsUrl,
} from "./routes";

describe("repository route contracts", () => {
  test("encodes dynamic path segments independently", () => {
    expect(repositoryDashboardUrl("Acme Org/β", "widgets #1/api")).toBe(
      "/repos/Acme%20Org%2F%CE%B2/widgets%20%231%2Fapi",
    );
    expect(repositorySettingsUrl("Acme Org/β", "widgets #1/api")).toBe(
      "/settings/repositories/Acme%20Org%2F%CE%B2/widgets%20%231%2Fapi",
    );
  });

  test("uses the shipped single repository Automation filter", () => {
    const url = new URL(
      repositoryAutomationsUrl("Acme Org+β", "widgets & api"),
      "https://example.test",
    );

    expect(url.pathname).toBe("/automations");
    expect([...url.searchParams.keys()]).toEqual(["repository"]);
    expect(url.searchParams.get("repository")).toBe("Acme Org+β/widgets & api");
  });

  test("uses the shipped split Runs filters", () => {
    const url = new URL(
      repositoryRunsUrl("Acme Org+β", "widgets & api"),
      "https://example.test",
    );

    expect(url.pathname).toBe("/runs");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      repoOwner: "Acme Org+β",
      repoName: "widgets & api",
    });
  });
});
