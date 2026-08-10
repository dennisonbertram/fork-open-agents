/**
 * Tests for the "New repository" entry point in repo-selector-compact.tsx
 * (#1177).
 *
 * BT-CRS-101: The expanded picker (no repo selected) renders a
 *             "New repository" action.
 * BT-CRS-102: The collapsed picker (repo selected) does not render it.
 * BT-CRS-103: The picker wires the create dialog with the current owner's
 *             installation context, and a successful creation selects the
 *             new repo and refreshes the repo list.
 *
 * Uses renderToStaticMarkup like repo-selector-compact.test.tsx (no
 * DOM/testing-library in this repo's test setup); the dialog itself is
 * stubbed so its props/callbacks can be asserted directly.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// ── Dependency mocks — must be installed before importing the module ──────────

mock.module("@/hooks/use-session", () => ({
  useSession: () => ({
    hasGitHub: true,
    loading: false,
  }),
}));

mock.module("@/hooks/use-github-connection-status", () => ({
  useGitHubConnectionStatus: () => ({
    reconnectRequired: false,
  }),
}));

mock.module("@/lib/github/urls", () => ({
  buildGitHubReconnectUrl: (next: string) => `/reconnect?next=${next}`,
}));

type Installation = {
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  installationUrl: string | null;
};

let mockInstallations: Installation[] = [];

mock.module("swr", () => ({
  default: () => ({
    data: mockInstallations,
    isLoading: false,
  }),
}));

type InstallationRepo = {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  updated_at?: string;
};

let mockRepos: InstallationRepo[] = [];
let mockRefresh = mock(async () => mockRepos);

mock.module("@/hooks/use-installation-repos", () => ({
  useInstallationRepos: () => ({
    repos: mockRepos,
    isLoading: false,
    error: null,
    refresh: mockRefresh,
  }),
}));

type CreatedRepository = {
  owner: string;
  repoName: string;
  repoUrl?: string;
  cloneUrl?: string;
};

let capturedDialogProps: {
  owner: string;
  repositorySelection: "all" | "selected";
  installationUrl: string | null;
  onCreated: (result: CreatedRepository) => void;
} | null = null;

mock.module("@/components/create-repository-dialog", () => ({
  CreateRepositoryDialog: (props: Record<string, unknown>) => {
    capturedDialogProps = props as typeof capturedDialogProps;
    return <div data-testid="create-repository-dialog-stub" />;
  },
}));

const modulePromise = import("./repo-selector-compact");

const SELECTED_SCOPE_INSTALLATION: Installation = {
  installationId: 1,
  accountLogin: "acme",
  accountType: "Organization",
  repositorySelection: "selected",
  installationUrl: "https://github.com/settings/installations/1",
};

describe("RepoSelectorCompact — New repository entry point (#1177)", () => {
  beforeEach(() => {
    mockInstallations = [SELECTED_SCOPE_INSTALLATION];
    mockRepos = [];
    mockRefresh = mock(async () => mockRepos);
    capturedDialogProps = null;
  });

  test("BT-CRS-101: expanded picker renders a New repository action", async () => {
    const { RepoSelectorCompact } = await modulePromise;
    const html = renderToStaticMarkup(
      <RepoSelectorCompact
        selectedOwner="acme"
        selectedRepo=""
        onSelect={() => {}}
      />,
    );

    expect(html).toContain("New repository");
  });

  test("BT-CRS-102: collapsed picker (repo selected) does not render the action", async () => {
    mockRepos = [
      {
        name: "existing",
        full_name: "acme/existing",
        description: null,
        private: false,
      },
    ];

    const { RepoSelectorCompact } = await modulePromise;
    const html = renderToStaticMarkup(
      <RepoSelectorCompact
        selectedOwner="acme"
        selectedRepo="existing"
        onSelect={() => {}}
      />,
    );

    expect(html).not.toContain("New repository");
  });

  test("BT-CRS-103: creation success selects the new repo and refreshes the list", async () => {
    const onSelect = mock((_owner: string, _repo: string) => {});
    const { RepoSelectorCompact } = await modulePromise;
    renderToStaticMarkup(
      <RepoSelectorCompact
        selectedOwner="acme"
        selectedRepo=""
        onSelect={onSelect}
      />,
    );

    expect(capturedDialogProps).not.toBeNull();
    const dialogProps = capturedDialogProps as unknown as {
      owner: string;
      repositorySelection: "all" | "selected";
      installationUrl: string | null;
      onCreated: (result: CreatedRepository) => void;
    };
    expect(dialogProps.owner).toBe("acme");
    expect(dialogProps.repositorySelection).toBe("selected");
    expect(dialogProps.installationUrl).toBe(
      "https://github.com/settings/installations/1",
    );

    dialogProps.onCreated({
      owner: "acme",
      repoName: "my-repo",
      repoUrl: "https://github.com/acme/my-repo",
    });

    expect(onSelect).toHaveBeenCalledWith("acme", "my-repo");
    expect(mockRefresh).toHaveBeenCalled();
  });
});
