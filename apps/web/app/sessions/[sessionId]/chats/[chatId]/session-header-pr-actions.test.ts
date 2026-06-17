import { describe, expect, test } from "bun:test";
import { getPrActionStates } from "./session-header-pr-actions";

const base = {
  hasExistingPr: false,
  prStatus: null as "open" | "closed" | "merged" | null,
  hasChanges: false,
  busy: false,
};

describe("getPrActionStates", () => {
  test("no PR + changes → only Create PR enabled", () => {
    const s = getPrActionStates({ ...base, hasChanges: true });
    expect(s.create.enabled).toBe(true);
    expect(s.merge.enabled).toBe(false);
    expect(s.resolve.enabled).toBe(false);
  });

  test("no PR + no changes → Create PR disabled with a reason", () => {
    const s = getPrActionStates({ ...base, hasChanges: false });
    expect(s.create.enabled).toBe(false);
    expect(s.create.reason).toMatch(/no changes/i);
  });

  test("open PR, mergeable → only Merge enabled; Create disabled (PR exists)", () => {
    const s = getPrActionStates({
      ...base,
      hasExistingPr: true,
      prStatus: "open",
      mergeReadinessReasons: ["Required checks are still running"],
    });
    expect(s.merge.enabled).toBe(true);
    expect(s.resolve.enabled).toBe(false);
    expect(s.create.enabled).toBe(false);
    expect(s.create.reason).toMatch(/already exists/i);
  });

  test("open PR with conflicts → only Resolve enabled; Merge disabled", () => {
    const s = getPrActionStates({
      ...base,
      hasExistingPr: true,
      prStatus: "open",
      mergeReadinessReasons: ["Pull request has merge conflicts"],
    });
    expect(s.resolve.enabled).toBe(true);
    expect(s.merge.enabled).toBe(false);
    expect(s.merge.reason).toMatch(/conflict/i);
  });

  test("open PR, readiness not loaded → Merge enabled, Resolve disabled", () => {
    const s = getPrActionStates({
      ...base,
      hasExistingPr: true,
      prStatus: "open",
    });
    expect(s.merge.enabled).toBe(true);
    expect(s.resolve.enabled).toBe(false);
  });

  test("merged/closed PR → all three disabled", () => {
    for (const prStatus of ["merged", "closed"] as const) {
      const s = getPrActionStates({ ...base, hasExistingPr: true, prStatus });
      expect(s.create.enabled).toBe(false);
      expect(s.merge.enabled).toBe(false);
      expect(s.resolve.enabled).toBe(false);
    }
  });

  test("busy → everything disabled with a working reason", () => {
    const s = getPrActionStates({
      ...base,
      hasChanges: true,
      hasExistingPr: true,
      prStatus: "open",
      busy: true,
    });
    expect(s.create.enabled).toBe(false);
    expect(s.merge.enabled).toBe(false);
    expect(s.resolve.enabled).toBe(false);
    expect(s.merge.reason).toMatch(/working/i);
  });
});
