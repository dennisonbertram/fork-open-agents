import { describe, expect, test } from "bun:test";
import type { ManagedRuntimeProfileOption } from "@/app/api/sessions/[sessionId]/managed-runtime/profiles/route";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RuntimeModeSelectorCompact,
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
    // BT-001: When a profile with source="session" is selected, a "Manage profile"
    // button must appear in the dropdown so users can edit/re-test/delete it.
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorCompact
        managedRuntimeProfileId={sessionProfile.id}
        onManagedRuntimeProfileChange={() => {}}
        onManagedProfileDeleted={async () => {}}
        onManagedProfileSaved={() => {}}
        onRuntimeModeChange={() => {}}
        profiles={[sessionProfile]}
        runtimeMode="managed_runtime"
        selectedProfile={sessionProfile}
        sessionId="session-abc123"
      />,
    );

    expect(html).toContain("Manage profile");
  });

  test("does not render Manage-profile for built-in profiles (non-session source)", () => {
    // BT-002: Built-in profiles cannot be edited, so the manager trigger should
    // be absent (or show disabled "Built-in profile" text instead).
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorCompact
        managedRuntimeProfileId={profile.id}
        onManagedRuntimeProfileChange={() => {}}
        onManagedProfileDeleted={async () => {}}
        onManagedProfileSaved={() => {}}
        onRuntimeModeChange={() => {}}
        profiles={[profile]}
        runtimeMode="managed_runtime"
        selectedProfile={profile}
        sessionId="session-abc123"
      />,
    );

    // The manager is rendered but disabled/shows "Built-in profile" for non-session profiles
    expect(html).not.toContain("Manage profile");
  });
});
