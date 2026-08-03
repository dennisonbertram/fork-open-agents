/**
 * Behavior proof for AuthGuard when the auth check itself fails (#1086).
 *
 * This repo's test setup has no DOM/testing-library (see
 * sign-in-button.test.tsx docstring), so markup is asserted via
 * renderToStaticMarkup.
 *
 * BT-1086-001: A failed auth check does NOT render the signed-out sign-in
 *              prompt; it renders a retry alert instead.
 * BT-1086-002: A genuinely signed-out user still gets the sign-in prompt.
 * BT-1086-003: An authenticated user still gets the children.
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

type SessionState = {
  loading: boolean;
  isAuthenticated: boolean;
  isError: boolean;
};

let sessionState: SessionState = {
  loading: false,
  isAuthenticated: false,
  isError: false,
};

mock.module("@/hooks/use-session", () => ({
  useSession: () => ({
    session: null,
    loading: sessionState.loading,
    isAuthenticated: sessionState.isAuthenticated,
    isAdmin: false,
    hasGitHub: false,
    hasGitHubAccount: false,
    hasGitHubInstallations: false,
    error: sessionState.isError ? new Error("boom") : null,
    isError: sessionState.isError,
    retry: () => undefined,
  }),
}));

mock.module("./sign-in-button", () => ({
  SignInButton: () => <button type="button">Sign in with Vercel</button>,
}));

const authGuardModulePromise = import("./auth-guard");

describe("AuthGuard — failed auth check (#1086)", () => {
  test("BT-1086-001: a failed auth check does not render the sign-in prompt", async () => {
    const { AuthGuard } = await authGuardModulePromise;
    sessionState = { loading: false, isAuthenticated: false, isError: true };

    const html = renderToStaticMarkup(
      <AuthGuard>
        <div>protected</div>
      </AuthGuard>,
    );

    expect(html).not.toContain("Please sign in to continue");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
  });

  test("BT-1086-002: a signed-out user still gets the sign-in prompt", async () => {
    const { AuthGuard } = await authGuardModulePromise;
    sessionState = { loading: false, isAuthenticated: false, isError: false };

    const html = renderToStaticMarkup(
      <AuthGuard>
        <div>protected</div>
      </AuthGuard>,
    );

    expect(html).toContain("Please sign in to continue");
    expect(html).not.toContain("protected");
  });

  test("BT-1086-003: an authenticated user still gets the children", async () => {
    const { AuthGuard } = await authGuardModulePromise;
    sessionState = { loading: false, isAuthenticated: true, isError: false };

    const html = renderToStaticMarkup(
      <AuthGuard>
        <div>protected</div>
      </AuthGuard>,
    );

    expect(html).toContain("protected");
  });
});
