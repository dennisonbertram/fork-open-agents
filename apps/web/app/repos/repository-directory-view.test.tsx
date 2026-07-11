import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RepositoryDirectoryView } from "./repository-directory-view";

const repository = {
  owner: "Acme Org",
  name: "widgets & api",
  fullName: "Acme Org/widgets & api",
  description: "Durable coding tools",
  private: true,
  updatedAt: "2026-07-11T00:00:00.000Z",
  language: "TypeScript",
};

describe("RepositoryDirectoryView", () => {
  test("renders an encoded semantic repository list", () => {
    const html = renderToStaticMarkup(
      <RepositoryDirectoryView
        snapshot={{
          status: "ready",
          repositories: [repository],
          installationCount: 1,
          failedInstallationCount: 0,
          requestId: "request-1",
        }}
      />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain("Repositories");
    expect(html).toContain("<ul");
    expect(html).toContain("Acme Org/widgets &amp; api");
    expect(html).toContain('href="/repos/Acme%20Org/widgets%20%26%20api"');
    expect(html).toContain("Open Acme Org/widgets &amp; api");
  });

  test.each([
    ["github_not_connected", "Connect GitHub"],
    ["installation_required", "Install the GitHub App"],
    ["empty", "No accessible repositories"],
  ] as const)("renders distinct %s copy", (status, copy) => {
    const html = renderToStaticMarkup(
      <RepositoryDirectoryView
        snapshot={{
          status,
          repositories: [],
          installationCount: 0,
          failedInstallationCount: 0,
          requestId: "request-1",
        }}
      />,
    );
    expect(html).toContain(copy);
  });

  test("labels partial results without hiding usable repositories", () => {
    const html = renderToStaticMarkup(
      <RepositoryDirectoryView
        snapshot={{
          status: "partial",
          repositories: [repository],
          installationCount: 2,
          failedInstallationCount: 1,
          errorKind: "partial_provider_failure",
          requestId: "request-1",
        }}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Some GitHub installations could not be loaded");
    expect(html).toContain("Acme Org/widgets &amp; api");
  });

  test("does not misreport a partial provider response as a successful empty list", () => {
    const html = renderToStaticMarkup(
      <RepositoryDirectoryView
        snapshot={{
          status: "partial",
          repositories: [],
          installationCount: 2,
          failedInstallationCount: 1,
          errorKind: "partial_provider_failure",
          requestId: "request-1",
        }}
      />,
    );
    expect(html).toContain("Some GitHub installations could not be loaded");
    expect(html).toContain(
      "No repositories returned by available installations",
    );
    expect(html).not.toContain("No accessible repositories");
  });

  test("renders an accessible provider error with a recovery action", () => {
    const html = renderToStaticMarkup(
      <RepositoryDirectoryView
        snapshot={{
          status: "error",
          repositories: [],
          installationCount: 1,
          failedInstallationCount: 1,
          errorKind: "provider_unavailable",
          requestId: "request-1",
        }}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Repositories could not be loaded");
    expect(html).toContain('href="/settings/connections"');
  });
});
