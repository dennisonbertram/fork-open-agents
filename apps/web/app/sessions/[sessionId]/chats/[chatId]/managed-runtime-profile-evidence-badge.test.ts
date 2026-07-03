import { describe, expect, test } from "bun:test";
import type { ManagedRuntimeProfileOption } from "@/app/api/sessions/[sessionId]/managed-runtime/profiles/route";
import {
  getManagedRuntimeProfileEvidenceBadgeView,
  getManagedRuntimeProfileEvidenceSummary,
} from "./managed-runtime-profile-evidence-badge";

const baseProfile: ManagedRuntimeProfileOption = {
  id: "session-profile-draft-1",
  version: "draft-2026-05-24T00:00:00.000Z",
  displayName: "Repo Bun profile",
  description: "Generated profile",
  setupCommandCount: 1,
  verificationCommandCount: 1,
  expectedTools: ["bun"],
  optionalTools: [],
  defaultPorts: [3000],
  source: "session",
};

describe("managed runtime profile evidence badge", () => {
  test("does not render evidence for built-in profiles", () => {
    expect(
      getManagedRuntimeProfileEvidenceBadgeView({
        ...baseProfile,
        source: "built_in",
      }),
    ).toBeNull();
  });

  test("labels session profiles with a passing setup_and_verify test as tested", () => {
    const view = getManagedRuntimeProfileEvidenceBadgeView({
      ...baseProfile,
      testStatus: "passed",
      testedAt: "2026-05-24T00:01:00.000Z",
      lastTestScope: "setup_and_verify",
    });

    expect(view).toMatchObject({
      label: "Tested",
    });
    expect(view?.title).toContain("Tested");
    expect(view?.className).toContain("emerald");
  });

  // RED: today the badge grants "Tested" from any passing evidence
  // regardless of scope, so a verify-only pass over-promises that setup was
  // also tested (Decision D6).
  test("labels a passing verify-only test as verified on current sandbox, not tested", () => {
    const view = getManagedRuntimeProfileEvidenceBadgeView({
      ...baseProfile,
      testStatus: "passed",
      testedAt: "2026-05-24T00:01:00.000Z",
      lastTestScope: "verify",
    });

    expect(view).toMatchObject({
      label: "Verified on current sandbox — setup not tested",
    });
    expect(view?.className).not.toContain("emerald");
  });

  test("labels failing evidence as needing changes", () => {
    const view = getManagedRuntimeProfileEvidenceBadgeView({
      ...baseProfile,
      testStatus: "failed",
    });

    expect(view).toMatchObject({
      label: "Needs changes",
      title: "The source draft had failing test evidence",
    });
    expect(view?.className).toContain("destructive");
  });

  test("defaults session profiles without passing evidence to untested", () => {
    const view = getManagedRuntimeProfileEvidenceBadgeView(baseProfile);

    expect(view).toMatchObject({
      label: "Untested",
      title: "The source draft has not passed a sandbox test",
    });
    expect(view?.className).toContain("amber");
  });

  test("summarizes evidence for the runtime header tooltip", () => {
    expect(getManagedRuntimeProfileEvidenceSummary(undefined)).toBe(
      "No managed runtime profile is selected yet.",
    );
    expect(
      getManagedRuntimeProfileEvidenceSummary({
        ...baseProfile,
        source: "built_in",
      }),
    ).toBe("This is a built-in profile maintained by Open Agents.");
    expect(
      getManagedRuntimeProfileEvidenceSummary({
        ...baseProfile,
        testStatus: "passed",
        testedAt: "2026-05-24T00:01:00.000Z",
      }),
    ).toContain("passed sandbox testing");
    expect(
      getManagedRuntimeProfileEvidenceSummary({
        ...baseProfile,
        testStatus: "failed",
      }),
    ).toContain("failing source-draft evidence");
  });
});
