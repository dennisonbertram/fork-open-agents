import { describe, expect, test } from "bun:test";
import {
  addCommand,
  getProfileManagerEvidenceNotice,
  getUnsavedEditsWarning,
  normalizeCommandId,
  normalizeCommands,
  parseOptionalPositiveInteger,
  removeCommand,
  resolveProfileTestOutcome,
  updateCommand,
} from "./managed-runtime-profile-manager";

describe("managed runtime profile manager helpers", () => {
  test("explains untested edited profiles when source draft evidence is absent", () => {
    const notice = getProfileManagerEvidenceNotice({
      profile: {
        id: "session-profile-draft-1",
        version: "edited-2026-05-24T00:00:00.000Z",
        displayName: "Edited profile",
        description: "Profile edited after approval",
        setupCommandCount: 1,
        verificationCommandCount: 1,
        expectedTools: ["bun"],
        optionalTools: [],
        defaultPorts: [3000],
        source: "session",
        testStatus: "untested",
        testedAt: null,
      },
      sourceDraft: undefined,
    });

    expect(notice).toContain("original draft evidence no longer proves");
  });

  test("does not show an evidence notice for built-in or source-backed profiles", () => {
    expect(
      getProfileManagerEvidenceNotice({
        profile: {
          id: "web-bun-agent-browser",
          version: "1",
          displayName: "Web app",
          description: "Built-in",
          setupCommandCount: 1,
          verificationCommandCount: 1,
          expectedTools: ["bun"],
          optionalTools: [],
          defaultPorts: [3000],
          source: "built_in",
        },
        sourceDraft: undefined,
      }),
    ).toBeNull();

    expect(
      getProfileManagerEvidenceNotice({
        profile: {
          id: "session-profile-draft-1",
          version: "draft-2026-05-24T00:00:00.000Z",
          displayName: "Draft profile",
          description: "Profile from a tested draft",
          setupCommandCount: 1,
          verificationCommandCount: 1,
          expectedTools: ["bun"],
          optionalTools: [],
          defaultPorts: [3000],
          source: "session",
          testStatus: "passed",
          testedAt: "2026-05-24T00:01:00.000Z",
        },
        sourceDraft: {
          id: "draft-1",
          status: "tested",
          testFailureMessage: null,
          testResults: [],
          testedAt: "2026-05-24T00:01:00.000Z",
        },
      }),
    ).toBeNull();
  });

  test("does not show an evidence notice after the current saved profile is tested", () => {
    expect(
      getProfileManagerEvidenceNotice({
        profile: {
          id: "session-profile-draft-1",
          version: "edited-2026-05-24T00:00:00.000Z",
          displayName: "Edited profile",
          description: "Profile edited after approval",
          setupCommandCount: 1,
          verificationCommandCount: 1,
          expectedTools: ["bun"],
          optionalTools: [],
          defaultPorts: [3000],
          source: "session",
          testStatus: "passed",
          testedAt: "2026-05-24T00:04:00.000Z",
        },
        sourceDraft: undefined,
        testEvidence: {
          status: "passed",
          testFailureMessage: null,
          testResults: [],
          testedAt: "2026-05-24T00:04:00.000Z",
        },
      }),
    ).toBeNull();
  });

  test("normalizes editable command rows into API payload commands", () => {
    const commands = normalizeCommands(
      [
        {
          id: " Verify Bun ",
          label: " Verify Bun ",
          description: " Check the Bun binary ",
          command: " bun --version ",
          timeoutMs: 30_000,
          required: false,
        },
      ],
      "verification",
    );

    expect(commands).toEqual([
      {
        id: "verify-bun",
        label: "Verify Bun",
        description: "Check the Bun binary",
        command: "bun --version",
        timeoutMs: 30_000,
        required: false,
      },
    ]);
  });

  test("rejects empty required command fields before saving", () => {
    expect(() =>
      normalizeCommands(
        [
          {
            id: "install",
            label: "Install",
            description: "",
            command: "bun install",
          },
        ],
        "setup",
      ),
    ).toThrow("setup command 1 is missing required text");
  });

  test("adds, updates, and removes command rows without mutating the input", () => {
    const original = [
      {
        id: "install",
        label: "Install",
        description: "Install dependencies",
        command: "bun install",
      },
    ];

    const added = addCommand(original, "Setup commands");
    const updated = updateCommand(added, 1, {
      label: "Verify",
      command: "bun --version",
    });
    const removed = removeCommand(updated, 0);

    expect(original).toHaveLength(1);
    expect(added).toHaveLength(2);
    expect(added[1]?.id).toBe("setup-commands-2");
    expect(updated[1]?.label).toBe("Verify");
    expect(removed).toEqual([updated[1]]);
  });

  // RED: today the manager tests the SAVED state and never warns when the
  // in-progress form edits differ from the loaded/saved profile, so a user
  // can believe an edited-but-unsaved profile was tested.
  test("warns that Test runs the saved profile when the form has unsaved edits", () => {
    const savedFormState = {
      displayName: "Bun app",
      description: "Install and verify Bun",
      expectedTools: "bun",
      optionalTools: "",
      defaultPorts: "3000",
      setupCommands: [
        {
          id: "install-bun",
          label: "Install Bun",
          description: "Install Bun",
          command: "bun --version",
        },
      ],
      verificationCommands: [
        {
          id: "verify-bun",
          label: "Verify Bun",
          description: "Verify Bun",
          command: "bun --version",
        },
      ],
    };

    expect(
      getUnsavedEditsWarning({
        formState: { ...savedFormState, displayName: "Bun app (edited)" },
        savedFormState,
      }),
    ).toBe("You have unsaved edits — Test runs the saved profile.");

    expect(
      getUnsavedEditsWarning({
        formState: savedFormState,
        savedFormState,
      }),
    ).toBeNull();

    expect(
      getUnsavedEditsWarning({
        formState: savedFormState,
        savedFormState: null,
      }),
    ).toBeNull();
  });

  // Regression: an edit to a command ROW (not just top-level fields like
  // displayName) must also trigger the warning. This would fail if a future
  // change compared only the top-level scalar fields and ignored
  // setupCommands/verificationCommands.
  test("warns on unsaved edits to a command row, not just top-level fields", () => {
    const savedFormState = {
      displayName: "Bun app",
      description: "Install and verify Bun",
      expectedTools: "bun",
      optionalTools: "",
      defaultPorts: "3000",
      setupCommands: [
        {
          id: "install-bun",
          label: "Install Bun",
          description: "Install Bun",
          command: "bun --version",
        },
      ],
      verificationCommands: [
        {
          id: "verify-bun",
          label: "Verify Bun",
          description: "Verify Bun",
          command: "bun --version",
        },
      ],
    };

    const editedFormState = {
      ...savedFormState,
      verificationCommands: [
        {
          ...savedFormState.verificationCommands[0],
          command: "bun --revision",
        },
      ],
    };

    expect(
      getUnsavedEditsWarning({
        formState: editedFormState,
        savedFormState,
      }),
    ).toBe("You have unsaved edits — Test runs the saved profile.");
  });

  // RED: today `testProfile` throws a generic "Failed to test profile"
  // message whenever `!response.ok`, before it ever looks at the route's
  // structured `testEvidence` (errorKind/failureMessage/nextAction). A
  // non-sandbox-unavailable test failure (HTTP 500 with structured evidence)
  // must still surface the command-specific guidance instead of a plain
  // string.
  test("surfaces structured test evidence from a non-ok response instead of throwing", () => {
    const outcome = resolveProfileTestOutcome({
      responseOk: false,
      body: {
        profile: {
          id: "session-profile-draft-1",
          version: "edited-2026-05-24T00:00:00.000Z",
          displayName: "Bun app",
          description: "Install and verify Bun",
          setupCommands: [],
          verificationCommands: [],
          expectedTools: ["bun"],
          optionalTools: [],
          defaultPorts: [3000],
        },
        error: "Failed to test managed runtime profile",
        testEvidence: {
          status: "failed",
          testFailureMessage: "boom",
          testResults: [],
          testedAt: null,
          errorKind: "setup_exec_error",
          failureMessage: "boom",
          nextAction: "Resume the sandbox and try again.",
        },
      },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("expected structured outcome, got a thrown-error result");
    }
    expect(outcome.testError).toEqual({
      errorKind: "setup_exec_error",
      failureMessage: "boom",
      failedCommandLabel: undefined,
      nextAction: "Resume the sandbox and try again.",
    });
    expect(outcome.profile.id).toBe("session-profile-draft-1");
  });

  test("still throws a generic error when a non-ok response carries no structured evidence", () => {
    const outcome = resolveProfileTestOutcome({
      responseOk: false,
      body: { error: "Resume the sandbox before testing managed runtime profiles." },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("expected a thrown-error result");
    }
    expect(outcome.message).toBe(
      "Resume the sandbox before testing managed runtime profiles.",
    );
  });

  test("keeps one command row and normalizes ids and timeout inputs", () => {
    const command = {
      id: "install",
      label: "Install",
      description: "Install dependencies",
      command: "bun install",
    };

    expect(removeCommand([command], 0)).toEqual([command]);
    expect(normalizeCommandId("  Setup: Bun + Browser! ")).toBe(
      "setup-bun-browser",
    );
    expect(parseOptionalPositiveInteger("120000")).toBe(120_000);
    expect(parseOptionalPositiveInteger("")).toBeUndefined();
    expect(parseOptionalPositiveInteger("later")).toBeUndefined();
  });
});
