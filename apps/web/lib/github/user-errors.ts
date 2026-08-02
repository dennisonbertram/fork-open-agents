/**
 * Error thrown when the GitHub API rejects the stored user token (401/403).
 * Lets callers answer with a typed 4xx ("reconnect GitHub") instead of a 500.
 */
export class GitHubTokenRejectedError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`GitHub rejected the user token (status ${status})`);
    this.name = "GitHubTokenRejectedError";
    this.status = status;
  }
}
