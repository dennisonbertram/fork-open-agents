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

    expect(summary).toContain("Coordinator");
    expect(summary).toContain("delegates repo work to managed workers");
    expect(summary).toContain("Runtime Inspector");
    expect(summary).toContain("incomplete proof");
  });

  test("keeps classic mode explicit as direct work", () => {
    const summary = getRuntimeModeSummary({
      runtimeMode: "classic",
      profile,
    });

    expect(summary).toContain("top-level agent can work directly");
    expect(summary).toContain("Switch to managed runtime");
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

    expect(html).toContain("Managed");
    expect(html).toContain("Coordinator");
    expect(html).toContain("managed workers");
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
