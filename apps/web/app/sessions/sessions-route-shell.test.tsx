/**
 * Tests for sessions-route-shell.tsx create-session failure surfacing (#784).
 *
 * Covers the three createSession call sites: handleCreateSessionForRepo,
 * handleCreateSessionFromBranch, handleCreateSandboxFreeChat.
 *
 * BT-784-013: handleCreateSessionForRepo rejection surfaces a toast exactly
 *             once (no double toast) and does not leave a stuck state.
 * BT-784-014: handleCreateSessionFromBranch rejection surfaces a toast
 *             exactly once.
 * BT-784-015: handleCreateSandboxFreeChat rejection surfaces a toast exactly
 *             once.
 * BT-784-016: On success, no toast fires and navigation occurs (all three).
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CreateSessionError } from "@/lib/sessions/create-session-error";

// --- Mocks -------------------------------------------------------------------

const push = mock((_url: string, _opts?: unknown) => undefined);
const prefetch = mock((_url: string) => undefined);
mock.module("next/navigation", () => ({
  useRouter: () => ({ push, prefetch }),
  usePathname: () => "/sessions",
  useParams: () => ({}),
}));

const toastError = mock((_msg: string, _opts?: unknown) => undefined);
mock.module("sonner", () => ({
  toast: { error: toastError, success: mock(() => undefined) },
}));

let mockCreateSession: (input: unknown) => Promise<unknown> = async () => ({
  session: { id: "s1" },
  chat: { id: "c1" },
});

mock.module("@/hooks/use-sessions", () => ({
  useSessions: () => ({
    sessions: [],
    archivedCount: 0,
    loading: false,
    createSession: (input: unknown) => mockCreateSession(input),
    renameSession: mock(async () => undefined),
    archiveSession: mock(async () => undefined),
    unarchiveSession: mock(async () => undefined),
  }),
}));

mock.module("@/hooks/use-user-preferences", () => ({
  useUserPreferences: () => ({
    preferences: {
      defaultSandboxType: "vercel",
      autoCommitPush: false,
      autoCreatePr: false,
      alertsEnabled: true,
      alertSoundEnabled: true,
    },
  }),
}));

mock.module("@/hooks/use-background-chat-notifications", () => ({
  useBackgroundChatNotifications: () => undefined,
}));

// Capture the create-session callbacks passed into InboxSidebar so tests can
// invoke the real handlers directly.
let capturedOnCreateSessionForRepo: (
  owner: string,
  repo: string,
) => Promise<void> = async () => {};
let capturedOnCreateSessionFromBranch: (
  owner: string,
  repo: string,
  branch: string,
) => Promise<void> = async () => {};
let capturedOnCreateSandboxFreeChat: () => Promise<void> = async () => {};

mock.module("@/components/inbox-sidebar", () => ({
  InboxSidebar: (props: {
    onCreateSessionForRepo: (owner: string, repo: string) => Promise<void>;
    onCreateSessionFromBranch: (
      owner: string,
      repo: string,
      branch: string,
    ) => Promise<void>;
    onCreateSandboxFreeChat: () => Promise<void>;
  }) => {
    capturedOnCreateSessionForRepo = props.onCreateSessionForRepo;
    capturedOnCreateSessionFromBranch = props.onCreateSessionFromBranch;
    capturedOnCreateSandboxFreeChat = props.onCreateSandboxFreeChat;
    return <div data-testid="inbox-sidebar-stub" />;
  },
}));

mock.module("@/components/new-session-dialog", () => ({
  NewSessionDialog: () => <div data-testid="new-session-dialog-stub" />,
}));

mock.module("@/components/composio-workspace-settings-panel", () => ({
  ComposioWorkspaceSettingsPanel: () => (
    <div data-testid="composio-panel-stub" />
  ),
}));

// --- Helpers -----------------------------------------------------------------

const shellModulePromise = import("./sessions-route-shell");

describe("SessionsRouteShell — create-session failure surfacing", () => {
  beforeEach(() => {
    push.mockClear();
    prefetch.mockClear();
    toastError.mockClear();
    mockCreateSession = async () => ({
      session: { id: "s1" },
      chat: { id: "c1" },
    });
  });

  test("BT-784-013: handleCreateSessionForRepo rejection surfaces a toast exactly once, no stuck state", async () => {
    const { SessionsRouteShell } = await shellModulePromise;
    mockCreateSession = async () => {
      throw new CreateSessionError({
        message: "Couldn't create the session — try again",
        kind: "unknown",
      });
    };

    renderToStaticMarkup(
      <SessionsRouteShell currentUser={{ id: "u1" } as never} lastRepo={null}>
        <div />
      </SessionsRouteShell>,
    );

    await capturedOnCreateSessionForRepo("acme", "widgets");

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  test("BT-784-014: handleCreateSessionFromBranch rejection surfaces a toast exactly once", async () => {
    const { SessionsRouteShell } = await shellModulePromise;
    mockCreateSession = async () => {
      throw new CreateSessionError({
        message: "Couldn't create the session — try again",
        kind: "unknown",
      });
    };

    renderToStaticMarkup(
      <SessionsRouteShell currentUser={{ id: "u1" } as never} lastRepo={null}>
        <div />
      </SessionsRouteShell>,
    );

    await capturedOnCreateSessionFromBranch("acme", "widgets", "main");

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  test("BT-784-015: handleCreateSandboxFreeChat rejection surfaces a toast exactly once", async () => {
    const { SessionsRouteShell } = await shellModulePromise;
    mockCreateSession = async () => {
      throw new CreateSessionError({
        message: "Couldn't create the session — try again",
        kind: "unknown",
      });
    };

    renderToStaticMarkup(
      <SessionsRouteShell currentUser={{ id: "u1" } as never} lastRepo={null}>
        <div />
      </SessionsRouteShell>,
    );

    await capturedOnCreateSandboxFreeChat();

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  test("BT-784-016: on success all three handlers navigate with no toast", async () => {
    const { SessionsRouteShell } = await shellModulePromise;

    renderToStaticMarkup(
      <SessionsRouteShell currentUser={{ id: "u1" } as never} lastRepo={null}>
        <div />
      </SessionsRouteShell>,
    );

    await capturedOnCreateSessionForRepo("acme", "widgets");
    expect(push).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();

    push.mockClear();
    await capturedOnCreateSessionFromBranch("acme", "widgets", "main");
    expect(push).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();

    push.mockClear();
    await capturedOnCreateSandboxFreeChat();
    expect(push).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });
});
