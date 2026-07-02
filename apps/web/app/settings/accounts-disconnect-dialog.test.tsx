/**
 * Tests for #789: the GitHub disconnect confirmation dialog must accurately
 * describe what unlinkGitHub() actually does (revoke the OAuth token + delete
 * local rows) and must NOT claim it removes the GitHub App installation,
 * since no GitHub API call ever uninstalls the app. The dialog must also
 * offer a link to GitHub's own installation/connections management page.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountsDisconnectDialogBody } from "./accounts-disconnect-dialog";

describe("AccountsDisconnectDialogBody (#789)", () => {
  test("description no longer claims the GitHub App installation is removed", () => {
    const html = renderToStaticMarkup(
      <AccountsDisconnectDialogBody manageUrl="https://github.com/settings/connections/applications/abc123" />,
    );

    expect(html).not.toContain("remove all app installations");
  });

  test("description accurately states token revoke + local removal only", () => {
    const html = renderToStaticMarkup(
      <AccountsDisconnectDialogBody manageUrl="https://github.com/settings/connections/applications/abc123" />,
    );

    expect(html).toContain("revokes this app&#x27;s access");
    expect(html).toContain("removes your local connection");
    expect(html).toContain("installation itself stays on GitHub");
  });

  test("renders a link to the GitHub management URL with the correct href", () => {
    const manageUrl =
      "https://github.com/settings/connections/applications/abc123";
    const html = renderToStaticMarkup(
      <AccountsDisconnectDialogBody manageUrl={manageUrl} />,
    );

    expect(html).toContain(`href="${manageUrl}"`);
    expect(html).toContain("Manage installations on GitHub");
  });

  test("gracefully omits the link when manageUrl is unavailable (e.g. missing NEXT_PUBLIC_GITHUB_CLIENT_ID)", () => {
    const html = renderToStaticMarkup(
      <AccountsDisconnectDialogBody manageUrl={null} />,
    );

    expect(html).not.toContain("Manage installations on GitHub");
    expect(html).not.toContain('href="#"');
  });
});
