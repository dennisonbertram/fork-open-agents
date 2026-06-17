/**
 * Pure helper that builds the create-session input payload for the mobile New screen.
 *
 * Rules:
 * - When no repo is selected: omits all repo fields, sets isNewBranch false.
 * - When a repo is selected: sets cloneUrl, repoOwner, repoName, branch.
 * - autoCreatePr is forced to false when autoCommitPush is false (can't PR without pushing).
 * - sandboxType is always "vercel".
 */

export interface MobileRepoSelection {
  owner: string;
  name: string;
  cloneUrl: string;
  /** null when isNewBranch is true (server auto-generates the branch name) */
  branch: string | null;
  isNewBranch: boolean;
}

export interface MobileCreateSessionOptions {
  title?: string;
  repo?: MobileRepoSelection | null;
  autoCommitPush: boolean;
  autoCreatePr: boolean;
}

export interface MobileCreateSessionInput {
  title?: string;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  isNewBranch: boolean;
  sandboxType: "vercel";
  autoCommitPush: boolean;
  autoCreatePr: boolean;
}

/**
 * Build the wire payload for POST /api/sessions from mobile-form values.
 */
export function buildCreateSessionInput(
  options: MobileCreateSessionOptions,
): MobileCreateSessionInput {
  const { title, repo, autoCommitPush } = options;

  // autoCreatePr requires autoCommitPush; force it off if push is disabled
  const autoCreatePr = autoCommitPush ? options.autoCreatePr : false;

  if (!repo) {
    // Plain chat session — no repo fields
    return {
      title: title?.trim() || undefined,
      isNewBranch: false,
      sandboxType: "vercel",
      autoCommitPush,
      autoCreatePr,
    };
  }

  return {
    title: title?.trim() || undefined,
    repoOwner: repo.owner,
    repoName: repo.name,
    cloneUrl: repo.cloneUrl,
    // When isNewBranch is true, branch may be null; omit it so the server
    // auto-generates the branch name instead of receiving an empty string.
    branch: repo.branch ?? undefined,
    isNewBranch: repo.isNewBranch,
    sandboxType: "vercel",
    autoCommitPush,
    autoCreatePr,
  };
}
