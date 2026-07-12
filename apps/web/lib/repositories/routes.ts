function repositoryPath(prefix: string, owner: string, repo: string): string {
  return `${prefix}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function repositoryDashboardUrl(owner: string, repo: string): string {
  return repositoryPath("/repos", owner, repo);
}

export function repositorySettingsUrl(owner: string, repo: string): string {
  return repositoryPath("/settings/repositories", owner, repo);
}

export function repositoryAutomationsUrl(owner: string, repo: string): string {
  const params = new URLSearchParams({ repository: `${owner}/${repo}` });
  return `/automations?${params.toString()}`;
}

export function repositoryRunsUrl(owner: string, repo: string): string {
  const params = new URLSearchParams({ repoOwner: owner, repoName: repo });
  return `/runs?${params.toString()}`;
}

export function githubRepositoryUrl(owner: string, repo: string): string {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}
