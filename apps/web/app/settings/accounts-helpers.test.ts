import { describe, expect, test } from "bun:test";
import { shouldAutoExpandOrgs } from "./accounts-helpers";

describe("shouldAutoExpandOrgs", () => {
  test("returns false when every account has the app installed (happy path stays collapsed)", () => {
    expect(shouldAutoExpandOrgs(3, 3)).toBe(false);
  });

  test("returns true when at least one account is missing the install", () => {
    expect(shouldAutoExpandOrgs(2, 3)).toBe(true);
  });

  test("returns true when no accounts have the install", () => {
    expect(shouldAutoExpandOrgs(0, 3)).toBe(true);
  });

  test("returns true when installedCount is 0 and total is 1", () => {
    expect(shouldAutoExpandOrgs(0, 1)).toBe(true);
  });

  test("returns false when both counts are zero (no accounts)", () => {
    expect(shouldAutoExpandOrgs(0, 0)).toBe(false);
  });

  test("returns false when installedCount equals allAccountsCount (all installed)", () => {
    expect(shouldAutoExpandOrgs(5, 5)).toBe(false);
  });
});
