import { describe, expect, test } from "bun:test";
import type { ManagedRuntimeProfileOption } from "@/app/api/sessions/[sessionId]/managed-runtime/profiles/route";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RuntimeModeSelectorCompact,
  RuntimeModeSelectorManageItem,
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
  test("explains the coordinator and managed worker path before sending", () => {
    const summary = getRuntimeModeSummary({
      runtimeMode: "managed_runtime",
      profile,
    });

    expect(summary).toContain("Coordinated");
    expect(summary).toContain("managed workers");
    expect(summary).toContain("Runtime Inspector");
    expect(summary).toContain("proof bundle");
  });

  test("keeps classic mode explicit as direct work", () => {
    const summary = getRuntimeModeSummary({
      runtimeMode: "classic",
      profile,
    });

    expect(summary).toContain("Direct");
    expect(summary).toContain("edits your repo itself");
    expect(summary).toContain("Switch to Coordinated");
  });
});

describe("RuntimeModeSelectorCompact", () => {
  test("renders managed mode as a visible composer control", () => {
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

    // The trigger shows the outcome label + a short aria-label state.
    expect(html).toContain("Coordinated");
    expect(html).toContain("Runtime: Coordinated");
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
