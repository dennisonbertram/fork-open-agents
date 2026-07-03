import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { GITHUB_INSTALLATIONS_SETTINGS_URL } from "./accounts-helpers";

/**
 * Body content for the GitHub disconnect confirmation dialog (#789 / #828).
 *
 * unlinkGitHub() (apps/web/lib/github/actions/connection.ts) only revokes
 * this app's OAuth access token and deletes local database rows
 * (deleteGitHubAccountLink, deleteInstallationsByUserId). It never calls a
 * GitHub API to uninstall the GitHub App itself, so the copy here must not
 * claim that disconnecting removes the app installation. Instead it links
 * to GitHub's Installed GitHub Apps settings page
 * (GITHUB_INSTALLATIONS_SETTINGS_URL) so the user can uninstall the app
 * there if they want to fully remove access.
 *
 * This intentionally does NOT reuse getGitHubManageUrl (accounts-helpers.ts):
 * that URL points at the OAuth app authorization review page
 * (/settings/connections/applications/<client_id>), which does not offer
 * app uninstall and depends on NEXT_PUBLIC_GITHUB_CLIENT_ID being set. This
 * component always links to the fixed GITHUB_INSTALLATIONS_SETTINGS_URL
 * instead, which needs no env var or client ID.
 *
 * Rendered as the children of the existing <DialogDescription> in
 * accounts-section.tsx (kept there so the component stays a valid Radix
 * Dialog.Description consumer).
 */
export function AccountsDisconnectDialogBody() {
  return (
    <>
      This revokes this app&apos;s access to your GitHub account and removes
      your local connection. The GitHub App installation itself stays on GitHub
      — you can reconnect at any time.{" "}
      <Link
        href={GITHUB_INSTALLATIONS_SETTINGS_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
      >
        Manage installations on GitHub
        <ExternalLink className="size-3" />
      </Link>
    </>
  );
}
