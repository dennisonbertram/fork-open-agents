import { describe, expect, test } from "bun:test";
import {
  checkRepositoryAllowlist,
  parseRepositoryAllowlist,
} from "./repository-allowlist";

describe("repository allowlist policy", () => {
  test("classifies missing and blank configuration as missing", () => {
    expect(parseRepositoryAllowlist(undefined)).toEqual({
      state: "missing",
      entries: new Set(),
    });
    expect(parseRepositoryAllowlist("   ")).toEqual({
      state: "missing",
      entries: new Set(),
    });
  });

  test("accepts only the exact trimmed wildcard as allow-all", () => {
    expect(parseRepositoryAllowlist("  *  ")).toEqual({
      state: "wildcard",
      entries: new Set(),
    });
    expect(parseRepositoryAllowlist("*,acme/widgets")).toEqual({
      state: "invalid",
      entries: new Set(),
      invalidEntryCount: 1,
    });
  });

  test("normalizes valid entries and rejects the whole policy when any entry is malformed", () => {
    expect(
      parseRepositoryAllowlist(
        "Acme/Widgets, octo/hello-world\nvercel/next.js",
      ),
    ).toEqual({
      state: "list",
      entries: new Set(["acme/widgets", "octo/hello-world", "vercel/next.js"]),
    });
    expect(parseRepositoryAllowlist("acme/widgets,not-a-repo")).toEqual({
      state: "invalid",
      entries: new Set(),
      invalidEntryCount: 1,
    });
  });

  test("distinguishes operator configuration refusal from valid-list exclusion", () => {
    expect(
      checkRepositoryAllowlist(
        parseRepositoryAllowlist(undefined),
        "acme",
        "widgets",
      ),
    ).toEqual({ allowed: false, reason: "missing" });
    expect(
      checkRepositoryAllowlist(
        parseRepositoryAllowlist("bad-entry"),
        "acme",
        "widgets",
      ),
    ).toEqual({ allowed: false, reason: "invalid" });
    expect(
      checkRepositoryAllowlist(
        parseRepositoryAllowlist("acme/other"),
        "acme",
        "widgets",
      ),
    ).toEqual({ allowed: false, reason: "not_listed" });
    expect(
      checkRepositoryAllowlist(
        parseRepositoryAllowlist("*"),
        "acme",
        "widgets",
      ),
    ).toEqual({ allowed: true });
  });
});
