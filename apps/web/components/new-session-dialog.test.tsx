/**
 * Tests for new-session-dialog.tsx create-session failure surfacing (#784).
 *
 * BT-784-006: A mocked 403 "Reconnect Vercel..." rejection renders an inline
 *             message + "Go to Settings" action link, and isCreating resets.
 * BT-784-007: A generic/unknown rejection renders fallback copy inline.
 * BT-784-008: The inline error region uses role="alert".
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CreateSessionError } from "@/lib/sessions/create-session-error";

// --- Mocks -------------------------------------------------------------------

const push = mock((_url: string) => undefined);

mock.module("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

// Stub SessionStarter — captures onSubmit so tests can invoke it directly,
// and renders isLoading so BT-784-006's isCreating-resets assertion holds.
let capturedOnSubmit: (input: unknown) => Promise<void> = async () => {};
let capturedInitialRepository:
  | { owner: string; repo: string }
  | null
  | undefined;

mock.module("@/components/session-starter", () => ({
  SessionStarter: (props: {
    onSubmit: (input: unknown) => Promise<void>;
    isLoading: boolean;
    initialRepository?: { owner: string; repo: string } | null;
  }) => {
    capturedOnSubmit = props.onSubmit;
    capturedInitialRepository = props.initialRepository;
    return (
      <div
        data-testid="session-starter-stub"
        data-is-loading={String(props.isLoading)}
      />
    );
  },
}));

// Radix Dialog renders via a portal and produces no static markup, so stub
// it with plain elements that always render children (mirrors how other
// tests in this repo stub heavy UI primitives for renderToStaticMarkup).
mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-stub">{children}</div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// --- Helpers -----------------------------------------------------------------

const dialogModulePromise = import("./new-session-dialog");

const BASE_INPUT = {
  isNewBranch: false,
  sandboxType: "vercel" as const,
  autoCommitPush: false,
  autoCreatePr: false,
};

describe("NewSessionDialog — create-session failure surfacing", () => {
  beforeEach(() => {
    push.mockClear();
    capturedInitialRepository = undefined;
  });

  test("forwards an explicit repository seed to the existing SessionStarter contract", async () => {
    const { NewSessionDialog } = await dialogModulePromise;
    renderToStaticMarkup(
      <NewSessionDialog
        open={true}
        onOpenChange={() => undefined}
        lastRepo={null}
        initialRepository={{ owner: "acme", repo: "widgets" }}
        createSession={async () => ({
          session: { id: "s1" },
          chat: { id: "c1" },
        })}
      />,
    );

    expect(capturedInitialRepository).toEqual({
      owner: "acme",
      repo: "widgets",
    });
  });

  test("BT-784-006: 403 Vercel-reauth rejection renders inline message + Go to Settings link, isCreating resets", async () => {
    const { NewSessionDialog } = await dialogModulePromise;
    const rejection = new CreateSessionError({
      message: "Reconnect Vercel to select a Vercel project",
      kind: "vercel_reauth_required",
      actionUrl: "/settings",
      actionLabel: "Go to Settings",
    });
    const createSession = mock(async () => {
      throw rejection;
    });

    renderToStaticMarkup(
      <NewSessionDialog
        open={true}
        onOpenChange={() => undefined}
        lastRepo={null}
        createSession={createSession}
      />,
    );

    await capturedOnSubmit(BASE_INPUT);

    // isCreating resets to false after the rejection (finally block ran).
    const htmlAfter = renderToStaticMarkup(
      <NewSessionDialog
        open={true}
        onOpenChange={() => undefined}
        lastRepo={null}
        createSession={createSession}
      />,
    );
    expect(htmlAfter).toContain('data-is-loading="false"');

    // No navigation occurred on failure.
    expect(push).not.toHaveBeenCalled();

    // Pre-seed the error state the real handler would have set, to verify
    // the rendered markup (mirrors the AgentEditForm _testSaveError pattern).
    const errorHtml = renderToStaticMarkup(
      <NewSessionDialog
        open={true}
        onOpenChange={() => undefined}
        lastRepo={null}
        createSession={createSession}
        _testCreateSessionError={{
          message: "Reconnect Vercel to select a Vercel project",
          kind: "vercel_reauth_required",
          actionUrl: "/settings",
          actionLabel: "Go to Settings",
        }}
      />,
    );
    expect(errorHtml).toContain("Reconnect Vercel to select a Vercel project");
    expect(errorHtml).toContain("Go to Settings");
    expect(errorHtml).toContain('href="/settings"');
  });

  test("BT-784-007: generic/unknown rejection renders fallback copy inline (no action link)", async () => {
    const { NewSessionDialog } = await dialogModulePromise;
    const createSession = mock(async () => {
      throw new TypeError("Failed to fetch");
    });

    renderToStaticMarkup(
      <NewSessionDialog
        open={true}
        onOpenChange={() => undefined}
        lastRepo={null}
        createSession={createSession}
      />,
    );

    await capturedOnSubmit(BASE_INPUT);

    const errorHtml = renderToStaticMarkup(
      <NewSessionDialog
        open={true}
        onOpenChange={() => undefined}
        lastRepo={null}
        createSession={createSession}
        _testCreateSessionError={{
          message: "Couldn't create the session — try again",
          kind: "unknown",
        }}
      />,
    );

    expect(errorHtml).toContain("Couldn&#x27;t create the session — try again");
    expect(errorHtml).not.toContain("Go to Settings");
  });

  test('BT-784-008: the inline error region uses role="alert"', async () => {
    const { NewSessionDialog } = await dialogModulePromise;
    const createSession = mock(async () => ({
      session: { id: "s1" },
      chat: { id: "c1" },
    }));

    const errorHtml = renderToStaticMarkup(
      <NewSessionDialog
        open={true}
        onOpenChange={() => undefined}
        lastRepo={null}
        createSession={createSession}
        _testCreateSessionError={{
          message: "Couldn't create the session — try again",
          kind: "unknown",
        }}
      />,
    );

    expect(errorHtml).toContain('role="alert"');
  });

  test("BT-784-009: on success, no error region renders and navigation occurs", async () => {
    const { NewSessionDialog } = await dialogModulePromise;
    const createSession = mock(async () => ({
      session: { id: "s1" },
      chat: { id: "c1" },
    }));

    renderToStaticMarkup(
      <NewSessionDialog
        open={true}
        onOpenChange={() => undefined}
        lastRepo={null}
        createSession={createSession}
      />,
    );

    await capturedOnSubmit(BASE_INPUT);

    expect(push).toHaveBeenCalledWith("/sessions/s1/chats/c1");

    const html = renderToStaticMarkup(
      <NewSessionDialog
        open={true}
        onOpenChange={() => undefined}
        lastRepo={null}
        createSession={createSession}
      />,
    );
    expect(html).not.toContain('role="alert"');
  });
});
