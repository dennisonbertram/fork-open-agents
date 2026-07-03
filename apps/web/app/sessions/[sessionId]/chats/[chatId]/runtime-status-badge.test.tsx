import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ManagedRuntimeProfileRunJson } from "./hooks/use-session-observability";
import {
  getRuntimeStatusBadgeView,
  RuntimeStatusBadge,
} from "./runtime-status-badge";

function profileRun(
  overrides: Partial<ManagedRuntimeProfileRunJson> = {},
): ManagedRuntimeProfileRunJson {
  return {
    id: "mprun_123",
    sessionId: "session_123",
    chatId: "chat_123",
    userId: "user_123",
    workflowRunId: "wrun_123",
    sandboxName: "sbx_runtime_123",
    profileId: "web-bun-agent-browser",
    profileVersion: "2026-05-23.2",
    profileDisplayName: "Web app with Bun and browser checks",
    requestedProfileId: "web-bun-agent-browser",
    resolvedProfileId: "web-bun-agent-browser",
    status: "running",
    errorKind: null,
    nextAction: null,
    expectedTools: ["bun", "agent-browser"],
    optionalTools: ["node", "npm"],
    setupResults: [],
    verificationResults: [],
    summary: null,
    failureMessage: null,
    startedAt: "2026-05-26T20:00:00.000Z",
    finishedAt: null,
    createdAt: "2026-05-26T20:00:00.000Z",
    updatedAt: "2026-05-26T20:00:00.000Z",
    ...overrides,
  };
}

describe("getRuntimeStatusBadgeView", () => {
  test("returns null in classic mode — badge must be absent", () => {
    const view = getRuntimeStatusBadgeView({
      runtimeMode: "classic",
      latestProfileRun: null,
    });

    expect(view).toBeNull();
  });

  test("shows Verifying… while the profile run is still running", () => {
    const view = getRuntimeStatusBadgeView({
      runtimeMode: "managed_runtime",
      latestProfileRun: profileRun({ status: "running" }),
    });

    expect(view?.label).toContain("Managed");
    expect(view?.label).toContain("Web app with Bun and browser checks");
    expect(view?.label).toContain("Verifying…");
  });

  test("shows Verified when the profile run passed", () => {
    const view = getRuntimeStatusBadgeView({
      runtimeMode: "managed_runtime",
      latestProfileRun: profileRun({ status: "passed" }),
    });

    expect(view?.label).toContain("Verified");
    expect(view?.tone).toBe("success");
  });

  test("shows Setup failed when the profile run failed", () => {
    const view = getRuntimeStatusBadgeView({
      runtimeMode: "managed_runtime",
      latestProfileRun: profileRun({
        status: "failed",
        errorKind: "setup_command_failed",
      }),
    });

    expect(view?.label).toContain("Setup failed");
    expect(view?.tone).toBe("failure");
  });

  test("shows Evidence unavailable when managed mode has no ProfileRun yet", () => {
    const view = getRuntimeStatusBadgeView({
      runtimeMode: "managed_runtime",
      latestProfileRun: null,
    });

    expect(view?.label).toContain("Evidence unavailable");
  });

  test("blocked status reports Evidence unavailable (a required command never verified)", () => {
    const view = getRuntimeStatusBadgeView({
      runtimeMode: "managed_runtime",
      latestProfileRun: profileRun({ status: "blocked" }),
    });

    expect(view?.label).toContain("Evidence unavailable");
  });
});

describe("RuntimeStatusBadge", () => {
  test("renders nothing in classic mode", () => {
    const html = renderToStaticMarkup(
      <RuntimeStatusBadge
        latestProfileRun={null}
        onOpenInspector={() => {}}
        runtimeMode="classic"
      />,
    );

    expect(html).toBe("");
  });

  test("renders a clickable button with an aria-label naming mode, profile, and state", () => {
    const html = renderToStaticMarkup(
      <RuntimeStatusBadge
        latestProfileRun={profileRun({ status: "passed" })}
        onOpenInspector={() => {}}
        runtimeMode="managed_runtime"
      />,
    );

    expect(html).toContain("<button");
    expect(html).toContain("aria-label=");
    expect(html).toContain("Managed");
    expect(html).toContain("Web app with Bun and browser checks");
    expect(html).toContain("Verified");
  });

  test("renders a requested-vs-resolved mismatch warning naming both ids", () => {
    const html = renderToStaticMarkup(
      <RuntimeStatusBadge
        latestProfileRun={profileRun({
          status: "passed",
          requestedProfileId: "custom-profile-a",
          resolvedProfileId: "web-bun-agent-browser",
        })}
        onOpenInspector={() => {}}
        runtimeMode="managed_runtime"
      />,
    );

    expect(html).toContain("custom-profile-a");
    expect(html).toContain("web-bun-agent-browser");
  });
});

// ── Regression ──────────────────────────────────────────────────────────────
describe("RuntimeStatusBadge regression", () => {
  // If loading-state priority is lost, the badge would render "Evidence
  // unavailable" for a fraction of a second on every normal load — pinned
  // per issue #815 §14 concern.
  test("reports loading state distinctly from evidence-unavailable when isLoading is true", () => {
    const view = getRuntimeStatusBadgeView({
      runtimeMode: "managed_runtime",
      latestProfileRun: null,
      isLoading: true,
    });

    expect(view?.label).not.toContain("Evidence unavailable");
    expect(view?.label).toContain("Loading");
  });
});
