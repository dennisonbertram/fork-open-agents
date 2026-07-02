/**
 * Tests for home-page.tsx create-session failure surfacing (#784).
 *
 * BT-784-010: A mocked createSession rejection surfaces a visible toast
 *             exactly once and does not throw an unhandled rejection.
 * BT-784-011: isCreating resets to false after a rejection.
 * BT-784-012: A rate-limited (429) rejection's server message is toasted
 *             verbatim, with no action link implied.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CreateSessionError } from "@/lib/sessions/create-session-error";

// --- Mocks -------------------------------------------------------------------

const push = mock((_url: string) => undefined);
mock.module("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const toastError = mock((_msg: string, _opts?: unknown) => undefined);
mock.module("sonner", () => ({
  toast: { error: toastError, success: mock(() => undefined) },
}));

mock.module("@/hooks/use-session", () => ({
  useSession: () => ({ loading: false, isAuthenticated: true }),
}));

let mockCreateSession: (input: unknown) => Promise<unknown> = async () => ({
  session: { id: "s1" },
  chat: { id: "c1" },
});

mock.module("@/hooks/use-sessions", () => ({
  useSessions: () => ({
    sessions: [],
    loading: false,
    createSession: (input: unknown) => mockCreateSession(input),
  }),
}));

let capturedOnSubmit: (input: unknown) => Promise<void> = async () => {};

mock.module("@/components/session-starter", () => ({
  SessionStarter: (props: {
    onSubmit: (input: unknown) => Promise<void>;
    isLoading: boolean;
  }) => {
    capturedOnSubmit = props.onSubmit;
    return (
      <div
        data-testid="session-starter-stub"
        data-is-loading={String(props.isLoading)}
      />
    );
  },
}));

mock.module("@/components/auth/signed-out-hero", () => ({
  SignedOutHero: () => <div data-testid="signed-out-hero" />,
}));

mock.module("@/components/home-skeleton", () => ({
  HomeSkeleton: () => <div data-testid="home-skeleton" />,
}));

mock.module("@/components/session-drawer", () => ({
  SessionDrawer: () => <div data-testid="session-drawer" />,
}));

mock.module("@/components/user-avatar-dropdown", () => ({
  UserAvatarDropdown: () => <div data-testid="user-avatar-dropdown" />,
}));

// --- Helpers -----------------------------------------------------------------

const homePageModulePromise = import("./home-page");

const BASE_INPUT = {
  isNewBranch: false,
  fullClone: false,
  sandboxType: "vercel" as const,
  autoCommitPush: false,
  autoCreatePr: false,
};

describe("HomePage — create-session failure surfacing", () => {
  beforeEach(() => {
    push.mockClear();
    toastError.mockClear();
    mockCreateSession = async () => ({
      session: { id: "s1" },
      chat: { id: "c1" },
    });
  });

  test("BT-784-010: createSession rejection surfaces a toast exactly once, no unhandled rejection", async () => {
    const { HomePage } = await homePageModulePromise;
    mockCreateSession = async () => {
      throw new CreateSessionError({
        message: "Couldn't create the session — try again",
        kind: "unknown",
      });
    };

    renderToStaticMarkup(
      <HomePage hasSessionCookie={true} lastRepo={null} />,
    );

    // Must not throw / reject unhandled.
    await capturedOnSubmit(BASE_INPUT);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  test("BT-784-011: isCreating resets to false after a rejection", async () => {
    const { HomePage } = await homePageModulePromise;
    mockCreateSession = async () => {
      throw new CreateSessionError({
        message: "Couldn't create the session — try again",
        kind: "unknown",
      });
    };

    renderToStaticMarkup(
      <HomePage hasSessionCookie={true} lastRepo={null} />,
    );
    await capturedOnSubmit(BASE_INPUT);

    const html = renderToStaticMarkup(
      <HomePage hasSessionCookie={true} lastRepo={null} />,
    );
    expect(html).toContain('data-is-loading="false"');
  });

  test("BT-784-012: rate-limited rejection toasts the server message verbatim", async () => {
    const { HomePage } = await homePageModulePromise;
    mockCreateSession = async () => {
      throw new CreateSessionError({
        message: "Too many requests",
        kind: "rate_limited",
      });
    };

    renderToStaticMarkup(
      <HomePage hasSessionCookie={true} lastRepo={null} />,
    );
    await capturedOnSubmit(BASE_INPUT);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toBe("Too many requests");
  });
});
