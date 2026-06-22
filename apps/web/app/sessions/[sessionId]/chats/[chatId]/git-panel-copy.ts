export function getPullRequestCreationNotice({
  branchName,
  baseBranch,
  willAutoGenerateTitle,
}: {
  branchName: string;
  baseBranch: string;
  willAutoGenerateTitle: boolean;
}) {
  const titleNotice = willAutoGenerateTitle
    ? "The title and description will be generated first."
    : "The title and description above will be used.";

  return `Creates a GitHub pull request from ${branchName} into ${baseBranch}. ${titleNotice}`;
}
