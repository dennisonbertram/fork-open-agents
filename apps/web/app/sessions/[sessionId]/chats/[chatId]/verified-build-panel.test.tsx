/**
 * Tests for VerifiedBuildPanel: empty-state UI and the ShieldCheck aria-label
 * in session-header.
 *
 * BT-001: ShieldCheck button has aria-label="Verified Build"
 * BT-002: Panel shows "Verified Build is disabled" when harnessEnabled=false
 * BT-003: Panel shows "Start Verified Build" button when harnessEnabled=true and no run
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// ── SWR mock ──────────────────────────────────────────────────────────────────

type SwrState = {
  data?: { run: null; events: [] } | null;
  error?: Error | null;
  isLoading?: boolean;
  mutate?: () => void;
};

let swrState: SwrState = {};

mock.module("swr", () => ({
  default: (_key: unknown) => ({
    data: swrState.data ?? { run: null, events: [] },
    error: swrState.error ?? null,
    isLoading: swrState.isLoading ?? false,
    mutate: swrState.mutate ?? (() => {}),
  }),
}));

// ── Stub out SSE hook (not needed for static render tests) ─────────────────

mock.module(
  "./hooks/use-verified-build-events",
  () => ({
    useVerifiedBuildEvents: () => [],
  }),
);

// ── Import components after mocks are in place ────────────────────────────

const verifiedBuildPanelModule = import("./verified-build-panel");
const sessionHeaderModule = import("./session-header");

// ── BT-001: ShieldCheck aria-label ────────────────────────────────────────

describe("SessionHeader ShieldCheck button", () => {
  beforeEach(() => {
    swrState = {};
  });

  // BT-001: The ShieldCheck button must have aria-label="Verified Build"
  test("ShieldCheck button has aria-label='Verified Build'", async () => {
    // We test via the extracted pure-presenter component, not the full
    // SessionHeader which depends on many contexts. Instead we import the
    // module and check the rendered HTML of the isolated component.
    // For the header itself, we rely on a structural check through the module.
    //
    // Because SessionHeader requires React context providers that aren't
    // available in a server-render environment, we verify the aria-label
    // contract via the VerifiedBuildHeaderButton pure component exported from
    // session-header (added as part of this fix).
    const mod = await sessionHeaderModule;
    // The VerifiedBuildHeaderButton must be exported as a pure component
    expect("VerifiedBuildHeaderButton" in mod).toBe(true);

    const { VerifiedBuildHeaderButton } = mod;
    const html = renderToStaticMarkup(
      // Render with isActive=false (panel closed state)
      <VerifiedBuildHeaderButton isActive={false} onClick={() => {}} />,
    );
    // The button must carry aria-label="Verified Build"
    expect(html).toContain('aria-label="Verified Build"');
  });
});

// ── BT-002 & BT-003: Panel empty state ────────────────────────────────────

describe("VerifiedBuildPanel empty state", () => {
  beforeEach(() => {
    swrState = { data: { run: null, events: [] } };
  });

  // BT-002: When harness is disabled, the panel shows a "Verified Build is disabled" message
  test("shows 'Verified Build is disabled' empty state when harnessEnabled=false", async () => {
    const { VerifiedBuildPanelEmpty } = await verifiedBuildPanelModule;

    const html = renderToStaticMarkup(
      <VerifiedBuildPanelEmpty
        harnessEnabled={false}
        sessionId="session_123"
        chatId="chat_123"
        latestUserMessageId={null}
        onRunStarted={() => {}}
      />,
    );

    expect(html).toContain("Verified Build is disabled");
    // Must NOT show the start button when disabled
    expect(html).not.toContain("Start Verified Build");
  });

  // BT-003: When harness is enabled, the panel shows a "Start Verified Build" button
  test("shows 'Start Verified Build' button when harnessEnabled=true and no run exists", async () => {
    const { VerifiedBuildPanelEmpty } = await verifiedBuildPanelModule;

    const html = renderToStaticMarkup(
      <VerifiedBuildPanelEmpty
        harnessEnabled={true}
        sessionId="session_123"
        chatId="chat_123"
        latestUserMessageId="msg_123"
        onRunStarted={() => {}}
      />,
    );

    expect(html).toContain("Start Verified Build");
    // Must NOT show the disabled message when harness is enabled
    expect(html).not.toContain("Verified Build is disabled");
  });

  // BT-003b: Start button is disabled when latestUserMessageId is null
  test("Start Verified Build button is disabled when latestUserMessageId is null", async () => {
    const { VerifiedBuildPanelEmpty } = await verifiedBuildPanelModule;

    const html = renderToStaticMarkup(
      <VerifiedBuildPanelEmpty
        harnessEnabled={true}
        sessionId="session_123"
        chatId="chat_123"
        latestUserMessageId={null}
        onRunStarted={() => {}}
      />,
    );

    // Button must be present but disabled when no message id
    expect(html).toContain("Start Verified Build");
    expect(html).toContain("disabled");
  });
});
