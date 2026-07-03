import { describe, expect, test } from "bun:test";
import type { ManagedRuntimeProfileOption } from "@/app/api/sessions/[sessionId]/managed-runtime/profiles/route";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RuntimeModeSelectorCompact,
  RuntimeModeSelectorManageItem,
  RuntimeModeSelectorUntestedWarning,
  getRuntimeModeSummary,
} from "./runtime-mode-selector-compact";

const profile: ManagedRuntimeProfileOption = {
  id: "web-bun-agent-browser",
  version: "2026-05-23.2",
  displayName: "Web app with Bun and browser checks",
  description: "Built-in web profile",
  setupCommandCount: 2,
  verificationCommandCount: 2,
  expectedTools: ["bun", "agent-browser"],
  optionalTools: ["node"],
  defaultPorts: [3000],
  source: "built_in",
  testedAt: null,
};

const sessionProfile: ManagedRuntimeProfileOption = {
  id: "session-custom-profile",
  version: "2026-05-23.2",
  displayName: "My custom session profile",
  description: "Session-scoped profile",
  setupCommandCount: 1,
  verificationCommandCount: 1,
  expectedTools: ["bun"],
  optionalTools: [],
  defaultPorts: [3000],
  source: "session",
  testedAt: null,
};

describe("getRuntimeModeSummary", () => {
  test("explains the delegated verified-worker path before sending, in plain language", () => {
    const summary = getRuntimeModeSummary({
      runtimeMode: "managed_runtime",
      profile,
    });

    expect(summary).toContain(
      "delegates work to a verified sandbox worker and records evidence",
    );
    expect(summary).toContain("Runtime Inspector");
    expect(summary).not.toContain("Coordinated");
    expect(summary).not.toContain("proof bundle");
  });

  test("keeps direct mode explicit as the agent editing files itself, in plain language", () => {
    const summary = getRuntimeModeSummary({
      runtimeMode: "classic",
      profile,
    });

    expect(summary).toContain("Agent edits files directly");
    expect(summary).not.toContain("Coordinated");
  });
});

describe("RuntimeModeSelectorCompact", () => {
  test("renders managed mode as a visible composer control using plain language", () => {
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorCompact
        managedRuntimeProfileId={profile.id}
        onManagedRuntimeProfileChange={() => {}}
        onRuntimeModeChange={() => {}}
        profiles={[profile]}
        runtimeMode="managed_runtime"
        selectedProfile={profile}
      />,
    );

    // The trigger shows the outcome label + a short aria-label state, in plain language.
    expect(html).toContain("Delegated");
    expect(html).toContain("Runtime: Delegated");
    expect(html).not.toContain("Coordinated");
  });

  test("renders Manage-profile control when a session-source profile is selected", () => {
    // BT-001: When a profile with source="session" is selected, the manage-item
    // section must contain "Manage profile" so users can edit/re-test/delete it.
    //
    // Note: Radix DropdownMenuContent uses Presence (portal-gated rendering) and
    // does NOT emit children via renderToStaticMarkup when the menu is closed.
    // We test the extracted RuntimeModeSelectorManageItem presenter directly —
    // the same pattern used by WorkflowPickerItems. The full compound component
    // wires this in via RuntimeModeSelectorCompact (verified by typecheck + call-site audit).
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorManageItem
        onManagedProfileDeleted={async () => {}}
        onManagedProfileSaved={() => {}}
        selectedProfile={sessionProfile}
        sessionId="session-abc123"
      />,
    );

    expect(html).toContain("Manage profile");
  });

  test("does not render Manage-profile for built-in profiles (non-session source)", () => {
    // BT-002: Built-in profiles cannot be edited, so the manager trigger should
    // show "Built-in profile" instead of "Manage profile".
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorManageItem
        onManagedProfileDeleted={async () => {}}
        onManagedProfileSaved={() => {}}
        selectedProfile={profile}
        sessionId="session-abc123"
      />,
    );

    // The manager is rendered but shows "Built-in profile" for non-session profiles,
    // not "Manage profile"
    expect(html).not.toContain("Manage profile");
    expect(html).toContain("Built-in profile");
  });
});

// ── Regression tests ──────────────────────────────────────────────────────────
// These tests catch future breakage of the behaviors introduced in
// fix: TASK-191 surface ManagedRuntimeProfileManager in RuntimeModeSelectorCompact.

describe("RuntimeModeSelectorManageItem regression", () => {
  // Regression: if RuntimeModeSelectorManageItem is removed or not exported,
  // the Manage-profile path breaks completely — this catches both.
  test("RuntimeModeSelectorManageItem is exported from the module", async () => {
    const mod = await import("./runtime-mode-selector-compact");
    expect(typeof mod.RuntimeModeSelectorManageItem).toBe("function");
  });

  // Regression: if the canManage guard in ManagedRuntimeProfileManager is changed
  // to always return "Manage profile" regardless of source, BT-002 catches it.
  // This regression test specifically ensures source="built_in" NEVER gets the
  // editable trigger — even if the label computation changes.
  test("built-in profile manager trigger is disabled, not absent", () => {
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorManageItem
        onManagedProfileDeleted={async () => {}}
        onManagedProfileSaved={() => {}}
        selectedProfile={profile}
        sessionId="session-abc123"
      />,
    );

    // The button is present but disabled (cannot manage built-in profiles)
    expect(html).toContain('disabled=""');
    // The trigger label is "Built-in profile", NOT "Manage profile"
    expect(html).toContain("Built-in profile");
    expect(html).not.toContain("Manage profile");
  });

  // Regression: if sessionId prop is removed from RuntimeModeSelectorCompact,
  // the manage-item section is silently dropped. This ensures the prop is accepted.
  test("RuntimeModeSelectorCompact accepts sessionId without type error", () => {
    // This is a compile-time contract test — if RuntimeModeSelectorCompact drops
    // sessionId from its props, renderToStaticMarkup will throw or TS will fail.
    expect(() =>
      renderToStaticMarkup(
        <RuntimeModeSelectorCompact
          managedRuntimeProfileId={sessionProfile.id}
          onManagedProfileDeleted={async () => {}}
          onManagedProfileSaved={() => {}}
          onManagedRuntimeProfileChange={() => {}}
          onRuntimeModeChange={() => {}}
          profiles={[sessionProfile]}
          runtimeMode="managed_runtime"
          selectedProfile={sessionProfile}
          sessionId="session-abc123"
        />,
      ),
    ).not.toThrow();
  });

  // Regression: session-source profile trigger must NOT be disabled when a profile
  // is present. If `disabled` logic is inverted or sessionId check breaks, this fails.
  test("session-source profile manager trigger is NOT disabled when profile is present", () => {
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorManageItem
        onManagedProfileDeleted={async () => {}}
        onManagedProfileSaved={() => {}}
        selectedProfile={sessionProfile}
        sessionId="session-abc123"
      />,
    );

    expect(html).toContain("Manage profile");
    // The trigger must NOT be disabled — session profiles are editable
    // (disabled="" is how React renders disabled={true} in static markup)
    expect(html).not.toContain('disabled=""');
  });
});

const untestedSessionProfile: ManagedRuntimeProfileOption = {
  ...sessionProfile,
  testStatus: "untested",
  lastTestScope: null,
};

const verifyOnlySessionProfile: ManagedRuntimeProfileOption = {
  ...sessionProfile,
  testStatus: "passed",
  lastTestScope: "verify",
  testedAt: "2026-06-01T00:00:00.000Z",
};

const setupAndVerifyTestedProfile: ManagedRuntimeProfileOption = {
  ...sessionProfile,
  testStatus: "passed",
  lastTestScope: "setup_and_verify",
  testedAt: "2026-06-01T00:00:00.000Z",
};

describe("RuntimeModeSelectorUntestedWarning", () => {
  // BT: selecting a profile whose persisted state is not "Tested"
  // (setup_and_verify) shows an inline warning with a link to the Inspector.
  test("shows a warning + Inspector link for an untested profile", () => {
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorUntestedWarning
        onOpenInspector={() => {}}
        selectedProfile={untestedSessionProfile}
      />,
    );

    expect(html).toContain("Not yet tested");
    expect(html).toContain("<button");
    expect(html.toLowerCase()).toContain("inspector");
  });

  test("shows a warning for a verify-only pass (setup was never proven)", () => {
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorUntestedWarning
        onOpenInspector={() => {}}
        selectedProfile={verifyOnlySessionProfile}
      />,
    );

    expect(html).toContain("Not yet tested");
  });

  test("renders nothing once the profile has a setup_and_verify pass", () => {
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorUntestedWarning
        onOpenInspector={() => {}}
        selectedProfile={setupAndVerifyTestedProfile}
      />,
    );

    expect(html).toBe("");
  });

  test("renders nothing for built-in profiles (always considered ready)", () => {
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorUntestedWarning
        onOpenInspector={() => {}}
        selectedProfile={profile}
      />,
    );

    expect(html).toBe("");
  });

  test("renders nothing when no profile is selected", () => {
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorUntestedWarning
        onOpenInspector={() => {}}
        selectedProfile={undefined}
      />,
    );

    expect(html).toBe("");
  });
});

describe("RuntimeModeSelectorCompact — untested warning wiring", () => {
  // Selection must remain possible (warn, not block — fail-closed at run
  // time is the real gate). Radix DropdownMenuContent is portal-gated and
  // not emitted by renderToStaticMarkup when closed (same constraint
  // documented on RuntimeModeSelectorManageItem above), so this is a
  // compile-time contract test: the compound component accepts an untested
  // profile and an onOpenInspector prop without type or render errors.
  test("accepts an untested profile and onOpenInspector without throwing", () => {
    expect(() =>
      renderToStaticMarkup(
        <RuntimeModeSelectorCompact
          managedRuntimeProfileId={untestedSessionProfile.id}
          onManagedRuntimeProfileChange={() => {}}
          onOpenInspector={() => {}}
          onRuntimeModeChange={() => {}}
          profiles={[untestedSessionProfile]}
          runtimeMode="managed_runtime"
          selectedProfile={untestedSessionProfile}
        />,
      ),
    ).not.toThrow();
  });
});

// ── Regression ──────────────────────────────────────────────────────────────
describe("RuntimeModeSelectorUntestedWarning regression", () => {
  // Regression: if the component is removed or unexported, wiring into the
  // selector silently disappears with no compile error at call sites that
  // don't reference it directly.
  test("RuntimeModeSelectorUntestedWarning is exported from the module", async () => {
    const mod = await import("./runtime-mode-selector-compact");
    expect(typeof mod.RuntimeModeSelectorUntestedWarning).toBe("function");
  });

  // Regression: Decision D6 says only a setup_and_verify pass earns "Tested".
  // If the gate is loosened to just `testStatus === "passed"` (ignoring
  // lastTestScope), a verify-only pass would wrongly suppress the warning —
  // silently hiding that the profile's setup commands were never proven.
  test("still warns for a passed testStatus when lastTestScope is verify-only", () => {
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorUntestedWarning
        onOpenInspector={() => {}}
        selectedProfile={verifyOnlySessionProfile}
      />,
    );

    expect(html).not.toBe("");
    expect(html).toContain("Not yet tested");
  });
});
