/**
 * Error thrown when GitHub throttles the caller. GitHub uses 403 for primary
 * and secondary rate limits as well as for permission problems, so this is
 * kept distinct from token rejection: reconnecting GitHub does not fix it.
 */
export class GitHubRateLimitedError extends Error {
  readonly retryAfterSeconds: number | null;

  constructor(retryAfterSeconds: number | null) {
    super("GitHub rate limit exceeded");
    this.name = "GitHubRateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
