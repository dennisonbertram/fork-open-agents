/**
 * Tests for NotConnectedState's GitHub connect pending/error/retry contract
 * (#786).
 *
 * Ownership: `ob-auth-repo` walk finding — clicking "Connect" in
 * `/settings/connections` left the button permanently disabled with no
 * feedback when `authClient.linkSocial` rejected.
 *
 * This repo's test setup has no DOM/testing-library (see
 * repo-selector-compact.test.tsx docstring), so the interactive
 * try/catch/finally contract is verified as pure async logic mirroring the
 * component's shape via the shared `runAuthCta` helper (BT-786-030..031),
 * while idle-state markup is verified via renderToStaticMarkup
 * (BT-786-032).
 *
 * BT-786-030: A rejected `authClient.linkSocial` call resets `isLinking` to
 *             false and sets a visible error (not a permanent disabled
 *             dead-end).
 * BT-786-031: Retrying re-invokes `authClient.linkSocial` and clears a prior
 *             error on success.
 * BT-786-032: Idle markup renders the "Connect" label with no error text.
 * BT-786-033: The component wires the shared GITHUB_LINK_ERROR_MESSAGE
 *             (implementation marker).
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/hooks/use-session", () => ({
  useSession: () => ({
    hasGitHubAccount: false,
    hasGitHub: false,
    loading: false,
  }),
}));

mock.module("@/hooks/use-github-connection-status", () => ({
  useGitHubConnectionStatus: () => ({
    reconnectRequired: false,
    reason: null,
    isLoading: false,
    refresh: async () => {},
  }),
}));

mock.module("swr", () => ({
  default: () => ({ data: undefined, error: undefined, isLoading: false }),
  useSWRConfig: () => ({ mutate: async () => {} }),
}));

mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

mock.module("sonner", () => ({
  toast: {
    success: () => undefined,
    error: () => undefined,
    info: () => undefined,
  },
}));

mock.module("@/lib/github/actions/connection", () => ({
  unlinkGitHub: async () => ({ success: true }),
}));

mock.module("@/lib/auth/client", () => ({
  authClient: {
    linkSocial: async () => undefined,
  },
}));

const accountsSectionModulePromise = import("./accounts-section");

describe("NotConnectedState — pending/error/retry (#786)", () => {
  test("BT-786-030: rejection resets isLinking to false and sets a visible error (mirrors runAuthCta contract)", async () => {
    const { runAuthCta } = await import("@/lib/auth/run-auth-cta");
    const state: { isLinking: boolean; error: string | null } = {
      isLinking: false,
      error: null,
    };

    await runAuthCta({
      cta: "github_link_settings",
      errorMessage: "Couldn't connect GitHub. Try again.",
      action: () => Promise.reject(new Error("network down")),
      setPending: (value) => {
        state.isLinking = value;
      },
      setError: (value) => {
        state.error = value;
      },
    });

    expect(state.isLinking).toBe(false);
    expect(state.error).toBe("Couldn't connect GitHub. Try again.");
  });

  test("BT-786-031: retrying re-invokes the action and clears a prior error on success", async () => {
    const { retryAuthCta } = await import("@/lib/auth/run-auth-cta");
    let calls = 0;
    const state: { isLinking: boolean; error: string | null } = {
      isLinking: false,
      error: "Couldn't connect GitHub. Try again.",
    };

    await retryAuthCta({
      cta: "github_link_settings",
      errorMessage: "Couldn't connect GitHub. Try again.",
      action: () => {
        calls += 1;
        return Promise.resolve();
      },
      setPending: (value) => {
        state.isLinking = value;
      },
      setError: (value) => {
        state.error = value;
      },
    });

    expect(calls).toBe(1);
    expect(state.error).toBeNull();
  });

  test("BT-786-032: idle markup renders the Connect label with no error text", async () => {
    const { NotConnectedState } = await accountsSectionModulePromise;
    const html = renderToStaticMarkup(<NotConnectedState />);

    expect(html).toContain("Connect");
    expect(html).not.toContain("Try again");
  });

  test("BT-786-033: the module exports the shared GITHUB_LINK_ERROR_MESSAGE (implementation marker)", async () => {
    const accountsSectionModule = await accountsSectionModulePromise;
    expect(accountsSectionModule.GITHUB_LINK_ERROR_MESSAGE).toBe(
      "Couldn't connect GitHub. Try again.",
    );
  });
});
