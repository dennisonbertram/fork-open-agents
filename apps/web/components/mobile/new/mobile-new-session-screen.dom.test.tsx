/**
 * Regression tests for #1093.
 *
 * A failed `/api/github/installations` fetch (transport failure OR a schema
 * failure that `fetchInstallations` used to swallow into `[]`) must render a
 * load-failure state with a retry, NOT the genuine empty state
 * "No repositories found for this installation."
 */

import { registerDomTestHooks, render, waitFor, within } from "@/tests/dom";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { useEffect, useState } from "react";

registerDomTestHooks();

// --- Mocks -------------------------------------------------------------------

let installationsResult: () => Promise<unknown> = async () => [];
const fetcherMock = mock(async (_url: string) => installationsResult());

mock.module("@/lib/swr", () => ({ fetcher: fetcherMock }));

const mutateSpy = mock(async () => undefined);

// Minimal stand-in for useSWR: runs the real fetcher so the schema-failure
// path in `fetchInstallations` is exercised end to end.
function useFakeSwr(
  key: string | null,
  fetcher: (k: string) => Promise<unknown>,
) {
  const [state, setState] = useState<{ data?: unknown; error?: unknown }>({});
  useEffect(() => {
    if (!key) return;
    let live = true;
    fetcher(key)
      .then((data) => {
        if (live) setState({ data });
      })
      .catch((error: unknown) => {
        if (live) setState({ error });
      });
    return () => {
      live = false;
    };
  }, [key, fetcher]);
  return {
    data: state.data,
    error: state.error,
    isLoading: state.data === undefined && state.error === undefined,
    mutate: mutateSpy,
  };
}

mock.module("swr", () => ({ default: useFakeSwr }));

mock.module("@/hooks/use-session", () => ({
  useSession: () => ({ isAuthenticated: true, hasGitHub: true }),
}));

mock.module("@/hooks/use-sessions", () => ({
  useSessions: () => ({ createSession: async () => ({ chat: { id: "c1" } }) }),
}));

mock.module("@/hooks/use-user-preferences", () => ({
  useUserPreferences: () => ({ preferences: null }),
}));

mock.module("@/hooks/use-repo-defaults", () => ({
  useRepoDefaults: () => ({ defaults: null }),
}));

let reposResult: {
  repos: unknown[];
  isLoading: boolean;
  error: string | null;
} = { repos: [], isLoading: false, error: null };
const refreshRepos = mock(async () => undefined);
mock.module("@/hooks/use-installation-repos", () => ({
  useInstallationRepos: () => ({ ...reposResult, refresh: refreshRepos }),
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

mock.module("sonner", () => ({
  toast: { error: () => {}, success: () => {} },
}));

const screenPromise = import("./mobile-new-session-screen");

const goodInstallation = {
  installationId: 1,
  accountLogin: "acme",
  accountType: "Organization",
  repositorySelection: "all",
  installationUrl: null,
};

async function renderRepoMode() {
  const { MobileNewSessionScreen } = await screenPromise;
  const { container } = render(<MobileNewSessionScreen />);
  const q = within(container);
  const { userClick } = await import("@/tests/dom");
  await userClick(q.getByRole("button", { name: /with repo/i }));
  return q;
}

describe("MobileNewSessionScreen — installations load failure (#1093)", () => {
  beforeEach(() => {
    mutateSpy.mockClear();
    refreshRepos.mockClear();
    reposResult = { repos: [], isLoading: false, error: null };
    installationsResult = async () => [goodInstallation];
  });

  test("transport failure renders a load-failure state with retry, not the empty state", async () => {
    installationsResult = async () => {
      throw new Error("boom");
    };
    const q = await renderRepoMode();

    await waitFor(() => {
      expect(q.getByRole("button", { name: /retry/i })).toBeTruthy();
    });
    expect(
      q.queryByText(/No repositories found for this installation\./i),
    ).toBeNull();
  });

  test("schema failure is not swallowed into an empty state", async () => {
    installationsResult = async () => [{ nope: true }];
    const q = await renderRepoMode();

    await waitFor(() => {
      expect(q.getByRole("button", { name: /retry/i })).toBeTruthy();
    });
    expect(
      q.queryByText(/No repositories found for this installation\./i),
    ).toBeNull();
  });

  test("genuine empty state still renders when the fetch succeeds", async () => {
    installationsResult = async () => [goodInstallation];
    const q = await renderRepoMode();

    await waitFor(() => {
      expect(
        q.getByText(/No repositories found for this installation\./i),
      ).toBeTruthy();
    });
    expect(q.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});
