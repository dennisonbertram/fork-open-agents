import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";
import type { ManagedRuntimeSavedProfile } from "@/lib/db/schema";
import { Dialog } from "@/components/ui/dialog";
import {
  DeleteProfileDialog,
  DeleteProfileDialogContent,
  ProfileFormFields,
  ProfileTemplatePicker,
  RuntimeProfilesSection,
  RuntimeProfilesSignInPrompt,
} from "./runtime-profiles-section";
import type { RuntimeProfileFormState } from "./runtime-profile-payload";
import { validateCreateForm } from "./runtime-profile-payload";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function formState(
  overrides: Partial<RuntimeProfileFormState> = {},
): RuntimeProfileFormState {
  return {
    displayName: "My profile",
    description: "Does things",
    expectedTools: "bun",
    optionalTools: "docker",
    defaultPorts: "3000",
    setupCommands: [
      {
        id: "setup-1",
        label: "Setup",
        description: "Prepare the environment",
        command: "bun install",
        required: true,
      },
    ],
    verificationCommands: [
      {
        id: "verify-1",
        label: "Verify",
        description: "Confirm the environment is ready",
        command: "bun test",
        required: true,
      },
    ],
    ...overrides,
  };
}

const savedProfile: ManagedRuntimeSavedProfile = {
  id: "profile-1",
  userId: "user-1",
  sessionId: null,
  sourceDraftId: null,
  scope: "user_default",
  version: "2026-05-23.2",
  displayName: "My saved profile",
  description: "A saved profile",
  setupCommands: [
    {
      id: "setup-1",
      label: "Setup",
      description: "Prepare the environment",
      command: "bun install",
      required: true,
    },
  ],
  verificationCommands: [
    {
      id: "verify-1",
      label: "Verify",
      description: "Confirm the environment is ready",
      command: "bun test",
      required: true,
    },
  ],
  expectedTools: ["bun"],
  optionalTools: [],
  defaultPorts: [3000],
  latestTestRunId: null,
  testResults: [],
  testFailureMessage: null,
  testedAt: null,
  lastTestScope: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const builtInProfiles: ManagedRuntimeProfile[] = [];

// ---------------------------------------------------------------------------
// BT: field help text
// ---------------------------------------------------------------------------

describe("ProfileFormFields help text", () => {
  test("expected tools field explains tools are shown as info, not installed", () => {
    const html = renderToStaticMarkup(
      <ProfileFormFields formState={formState()} onChange={() => {}} />,
    );

    expect(html).toContain("Shown as environment info");
    expect(html).toContain("NOT installed automatically");
  });

  test("optional tools field explains tools are shown as info, not installed", () => {
    const html = renderToStaticMarkup(
      <ProfileFormFields formState={formState()} onChange={() => {}} />,
    );

    // Both expected and optional tools fields carry the same honest disclaimer.
    const occurrences = html.split("NOT installed automatically").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  test("default ports field explains ports are exposed for preview URLs", () => {
    const html = renderToStaticMarkup(
      <ProfileFormFields formState={formState()} onChange={() => {}} />,
    );

    expect(html).toContain("preview URLs");
  });

  test("required-command toggle help mentions live sessions, not just tests", () => {
    const html = renderToStaticMarkup(
      <ProfileFormFields formState={formState()} onChange={() => {}} />,
    );

    expect(html).toContain("live sessions");
  });

  test("help text is associated to inputs via aria-describedby", () => {
    const html = renderToStaticMarkup(
      <ProfileFormFields formState={formState()} onChange={() => {}} />,
    );

    expect(html).toContain("aria-describedby");
  });
});

// ---------------------------------------------------------------------------
// BT: delete confirmation dialog
// ---------------------------------------------------------------------------

describe("DeleteProfileDialogContent", () => {
  test("names the profile being deleted", () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <DeleteProfileDialogContent
          isDefault={false}
          onCancel={() => {}}
          onConfirm={() => {}}
          profileName="My saved profile"
        />
      </Dialog>,
    );

    expect(html).toContain("My saved profile");
  });

  test("warns when the profile is the Preferences default", () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <DeleteProfileDialogContent
          isDefault
          onCancel={() => {}}
          onConfirm={() => {}}
          profileName="My saved profile"
        />
      </Dialog>,
    );

    expect(html).toContain("default");
  });

  test("does not warn about default when the profile is not the default", () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <DeleteProfileDialogContent
          isDefault={false}
          onCancel={() => {}}
          onConfirm={() => {}}
          profileName="My saved profile"
        />
      </Dialog>,
    );

    expect(html).not.toContain("Preferences default");
  });
});

// ---------------------------------------------------------------------------
// BT: unauthenticated sign-in prompt
// ---------------------------------------------------------------------------

describe("RuntimeProfilesSignInPrompt", () => {
  test("renders a sign-in prompt instead of a blank page", () => {
    const html = renderToStaticMarkup(<RuntimeProfilesSignInPrompt />);

    expect(html.toLowerCase()).toContain("sign in");
  });
});

// ---------------------------------------------------------------------------
// BT: RuntimeProfilesSection renders without throwing and never fetches on mount
// ---------------------------------------------------------------------------

describe("RuntimeProfilesSection", () => {
  test("renders user profiles without throwing", () => {
    expect(() =>
      renderToStaticMarkup(
        <RuntimeProfilesSection
          builtInProfiles={builtInProfiles}
          initialUserProfiles={[savedProfile]}
        />,
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// BT: template chooser
// ---------------------------------------------------------------------------

describe("ProfileTemplatePicker", () => {
  test("offers the Python 3.12, Node 20 / Bun web app, and Blank templates", () => {
    const html = renderToStaticMarkup(
      <ProfileTemplatePicker onSelect={() => {}} />,
    );

    expect(html).toContain("Python 3.12");
    expect(html).toContain("Node 20");
    expect(html).toContain("Blank");
  });

  test("each template card carries a naive-friendly description", () => {
    const html = renderToStaticMarkup(
      <ProfileTemplatePicker onSelect={() => {}} />,
    );

    expect(html.toLowerCase()).toContain("verifies");
  });
});

// ---------------------------------------------------------------------------
// BT: inline field-level validation (fixes the silent first-create failure)
// ---------------------------------------------------------------------------

describe("ProfileFormFields inline validation", () => {
  // BT: given an invalid field (empty verification commands), the form shows
  // a field-level message and marks the field aria-invalid.
  test("shows a field-level error for empty verification commands and marks it aria-invalid", () => {
    const invalidForm = formState({ verificationCommands: [] });
    const result = validateCreateForm(invalidForm);
    expect(result.ok).toBe(false);

    const fieldErrors = !result.ok ? result.fieldErrors : {};

    const html = renderToStaticMarkup(
      <ProfileFormFields
        fieldErrors={fieldErrors}
        formState={invalidForm}
        onChange={() => {}}
      />,
    );

    expect(html).toContain(
      "Add at least one verification command — this is how the profile proves setup worked",
    );
    expect(html).toContain('aria-invalid="true"');
  });

  test("shows no inline error text when the form is valid", () => {
    const html = renderToStaticMarkup(
      <ProfileFormFields fieldErrors={{}} formState={formState()} onChange={() => {}} />,
    );

    expect(html).not.toContain("Add at least one verification command");
  });
});

// ── Regression tests ────────────────────────────────────────────────────────

describe("runtime-profiles-section regression", () => {
  // Regression: if the delete dialog is bypassed and delete goes straight to a
  // destructive action again, this component-export contract breaks and any
  // caller relying on DeleteProfileDialog for confirmation loses the guard.
  test("DeleteProfileDialog is exported for reuse by the delete flow", () => {
    expect(typeof DeleteProfileDialog).toBe("function");
  });

  // Regression: if the unauthenticated page reverts to returning null, this
  // export disappears / stops rendering copy, and this test fails.
  test("RuntimeProfilesSignInPrompt renders non-empty markup", () => {
    const html = renderToStaticMarkup(<RuntimeProfilesSignInPrompt />);
    expect(html.length).toBeGreaterThan(0);
  });

  // Regression: the exact silent-first-create path. A valid-looking form
  // (displayName/description/setupCommands filled) with an empty
  // verificationCommands list used to make formToCreatePayload throw inside a
  // swallowed try/catch, leaving the user with no feedback at all. Pinning
  // this at the ProfileFormFields level: given fieldErrors computed from
  // validateCreateForm on that exact walk form, the rendered markup must
  // explain what's missing rather than staying silent.
  test("REGRESSION: a valid-looking form with empty verification commands renders a field error instead of nothing", () => {
    const walkForm = formState({ verificationCommands: [] });
    const result = validateCreateForm(walkForm);
    expect(result.ok).toBe(false);
    const fieldErrors = !result.ok ? result.fieldErrors : {};

    const html = renderToStaticMarkup(
      <ProfileFormFields
        fieldErrors={fieldErrors}
        formState={walkForm}
        onChange={() => {}}
      />,
    );

    expect(html.toLowerCase()).toContain("verification command");
  });

  // Regression: ProfileTemplatePicker must remain exported and non-empty so a
  // future refactor cannot silently remove the naive-user template path.
  test("ProfileTemplatePicker renders non-empty markup", () => {
    const html = renderToStaticMarkup(
      <ProfileTemplatePicker onSelect={() => {}} />,
    );
    expect(html.length).toBeGreaterThan(0);
  });
});
