/**
 * Tests for create-repository-dialog.tsx and its submit helper (#1177) —
 * the new-session repo picker's "create an empty repository" flow.
 *
 * BT-CRD-001: The dialog shows the target owner, a name field, and defaults
 *             to a private repository.
 * BT-CRD-002: A pre-seeded error renders inline with role="alert".
 * BT-CRD-003: A pre-seeded success renders the repo full name and a
 *             "View on GitHub" link; no App-access warning for
 *             repositorySelection "all".
 * BT-CRD-004: On success with repositorySelection "selected" and an
 *             installationUrl, the success state warns that the GitHub App
 *             cannot see the repo yet and links to Manage access.
 * BT-CRD-005: submitCreateRepository posts the expected body to
 *             /api/github/repos and returns the created repo.
 * BT-CRD-006: submitCreateRepository surfaces the API error message.
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Radix Dialog renders via a portal and produces no static markup, so stub
// it with plain elements that always render children (mirrors
// new-session-dialog.test.tsx).
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
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const dialogModulePromise = import("./create-repository-dialog");
const submitModulePromise = import("./create-repository-submit");

const CREATED = {
  owner: "acme",
  repoName: "my-repo",
  repoUrl: "https://github.com/acme/my-repo",
  cloneUrl: "https://github.com/acme/my-repo.git",
};

describe("CreateRepositoryDialog", () => {
  test("BT-CRD-001: renders owner, name field, and private default on", async () => {
    const { CreateRepositoryDialog } = await dialogModulePromise;
    const html = renderToStaticMarkup(
      <CreateRepositoryDialog
        open
        onOpenChange={() => {}}
        owner="acme"
        repositorySelection="all"
        installationUrl={null}
        onCreated={() => {}}
      />,
    );

    expect(html).toContain("Create repository");
    expect(html).toContain("acme");
    expect(html).toContain("Repository name");
    expect(html).toContain("Private repository");
    expect(html).toContain('aria-checked="true"');
  });

  test("BT-CRD-002: pre-seeded error renders inline with role=alert", async () => {
    const { CreateRepositoryDialog } = await dialogModulePromise;
    const html = renderToStaticMarkup(
      <CreateRepositoryDialog
        open
        onOpenChange={() => {}}
        owner="acme"
        repositorySelection="all"
        installationUrl={null}
        onCreated={() => {}}
        _testError="GitHub rejected the request. Reconnect GitHub to grant repository creation access, then try again."
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain(
      "Reconnect GitHub to grant repository creation access",
    );
  });

  test("BT-CRD-003: success renders repo link without App-access warning for selection 'all'", async () => {
    const { CreateRepositoryDialog } = await dialogModulePromise;
    const html = renderToStaticMarkup(
      <CreateRepositoryDialog
        open
        onOpenChange={() => {}}
        owner="acme"
        repositorySelection="all"
        installationUrl="https://github.com/settings/installations/1"
        onCreated={() => {}}
        _testResult={CREATED}
      />,
    );

    expect(html).toContain("acme/my-repo");
    expect(html).toContain("https://github.com/acme/my-repo");
    expect(html).not.toContain("Manage access");
  });

  test("BT-CRD-004: success with selection 'selected' warns and links to Manage access", async () => {
    const { CreateRepositoryDialog } = await dialogModulePromise;
    const html = renderToStaticMarkup(
      <CreateRepositoryDialog
        open
        onOpenChange={() => {}}
        owner="acme"
        repositorySelection="selected"
        installationUrl="https://github.com/settings/installations/1"
        onCreated={() => {}}
        _testResult={CREATED}
      />,
    );

    expect(html).toContain("acme/my-repo");
    expect(html).toContain("Manage access");
    expect(html).toContain("https://github.com/settings/installations/1");
  });
});

describe("submitCreateRepository", () => {
  test("BT-CRD-005: posts the expected body and returns the created repo", async () => {
    const fetchImpl = mock(async (_url: string, _init?: RequestInit) =>
      Response.json({ success: true, ...CREATED }),
    );
    const { submitCreateRepository } = await submitModulePromise;

    const outcome = await submitCreateRepository({
      owner: "acme",
      repoName: "my-repo",
      description: "",
      isPrivate: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/github/repos");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      repoName: "my-repo",
      description: undefined,
      isPrivate: true,
      owner: "acme",
    });
    expect(outcome).toEqual({ ok: true, result: CREATED });
  });

  test("BT-CRD-006: surfaces the API error message on failure", async () => {
    const fetchImpl = mock(async () =>
      Response.json(
        {
          error: 'A repository named "my-repo" already exists under acme.',
          errorKind: "repo_name_taken",
        },
        { status: 409 },
      ),
    );
    const { submitCreateRepository } = await submitModulePromise;

    const outcome = await submitCreateRepository({
      owner: "acme",
      repoName: "my-repo",
      description: undefined,
      isPrivate: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(outcome).toEqual({
      ok: false,
      error: 'A repository named "my-repo" already exists under acme.',
    });
  });
});
