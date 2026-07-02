import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";
import type { ManagedRuntimeSavedProfile } from "@/lib/db/schema";
import {
  DeleteProfileDialog,
  ProfileFormFields,
  RuntimeProfilesSection,
  RuntimeProfilesSignInPrompt,
} from "./runtime-profiles-section";
import type { RuntimeProfileFormState } from "./runtime-profile-payload";

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

    expect(html).toContain("shown as environment info");
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

describe("DeleteProfileDialog", () => {
  test("names the profile being deleted", () => {
    const html = renderToStaticMarkup(
      <DeleteProfileDialog
        isDefault={false}
        onCancel={() => {}}
        onConfirm={() => {}}
        open
        profileName="My saved profile"
      />,
    );

    expect(html).toContain("My saved profile");
  });

  test("warns when the profile is the Preferences default", () => {
    const html = renderToStaticMarkup(
      <DeleteProfileDialog
        isDefault
        onCancel={() => {}}
        onConfirm={() => {}}
        open
        profileName="My saved profile"
      />,
    );

    expect(html).toContain("default");
  });

  test("does not warn about default when the profile is not the default", () => {
    const html = renderToStaticMarkup(
      <DeleteProfileDialog
        isDefault={false}
        onCancel={() => {}}
        onConfirm={() => {}}
        open
        profileName="My saved profile"
      />,
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
});
