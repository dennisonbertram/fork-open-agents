/**
 * Tests for #789 / #828: the GitHub disconnect confirmation dialog must
 * accurately describe what unlinkGitHub() actually does (revoke the OAuth
 * token + delete local rows) and must NOT claim it removes the GitHub App
 * installation, since no GitHub API call ever uninstalls the app. The
 * dialog must also offer a link to GitHub's Installed GitHub Apps settings
 * page (where uninstalling the app actually happens), not the OAuth app
 * authorization review page.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountsDisconnectDialogBody } from "./accounts-disconnect-dialog";

describe("AccountsDisconnectDialogBody (#789)", () => {
  test("description no longer claims the GitHub App installation is removed", () => {
    const html = renderToStaticMarkup(<AccountsDisconnectDialogBody />);

    expect(html).not.toContain("remove all app installations");
  });

  test("description accurately states token revoke + local removal only", () => {
    const html = renderToStaticMarkup(<AccountsDisconnectDialogBody />);

    expect(html).toContain("revokes this app&#x27;s access");
    expect(html).toContain("removes your local connection");
    expect(html).toContain("installation itself stays on GitHub");
  });

  test("renders a link to the Installed GitHub Apps settings page", () => {
    const html = renderToStaticMarkup(<AccountsDisconnectDialogBody />);

    expect(html).toContain('href="https://github.com/settings/installations"');
    expect(html).toContain("Manage installations on GitHub");
  });

  test("links to the Installed GitHub Apps settings page, not the OAuth app authorization page (#828)", () => {
    // The dialog must send the user to https://github.com/settings/installations
    // (where uninstalling the GitHub App actually happens), not to
    // /settings/connections/applications/<client_id> (the OAuth grant review
    // page returned by getGitHubManageUrl), which does not offer app uninstall.
    const html = renderToStaticMarkup(<AccountsDisconnectDialogBody />);

    expect(html).toContain('href="https://github.com/settings/installations"');
    expect(html).not.toContain(
      "github.com/settings/connections/applications/",
    );
  });
});
