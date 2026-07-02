import { ExternalLink } from "lucide-react";
import Link from "next/link";

/**
 * Body content for the GitHub disconnect confirmation dialog (#789).
 *
 * unlinkGitHub() (apps/web/lib/github/actions/connection.ts) only revokes
 * this app's OAuth access token and deletes local database rows
 * (deleteGitHubAccountLink, deleteInstallationsByUserId). It never calls a
 * GitHub API to uninstall the GitHub App itself, so the copy here must not
 * claim that disconnecting removes the app installation. Instead it links
 * to GitHub's own installation/connections management page so the user can
 * uninstall the app there if they want to fully remove access.
 *
 * Rendered as the children of the existing <DialogDescription> in
 * accounts-section.tsx (kept there so the component stays a valid Radix
 * Dialog.Description consumer).
 */
export function AccountsDisconnectDialogBody({
  manageUrl,
}: {
  manageUrl: string | null;
}) {
  return (
    <>
      This revokes this app&apos;s access to your GitHub account and removes
      your local connection. The GitHub App installation itself stays on
      GitHub — you can reconnect at any time.
      {manageUrl ? (
        <>
          {" "}
          <Link
            href={manageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
          >
            Manage installations on GitHub
            <ExternalLink className="size-3" />
          </Link>
        </>
      ) : null}
    </>
  );
}
