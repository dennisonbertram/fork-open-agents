import "server-only";

export type GithubSecretsErrorKind =
  | "github_not_connected"
  | "no_installation"
  | "app_no_access"
  | "repo_access_denied"
  | "app_no_secrets_permission"
  | "secret_name_invalid"
  | "secret_too_large"
  | "github_rate_limited"
  | "github_error";

export function getGitHubHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const direct = (error as { status?: unknown }).status;
  if (typeof direct === "number") {
    return direct;
  }

  const response = (error as { response?: { status?: unknown } }).response;
  if (typeof response?.status === "number") {
    return response.status;
  }

  return null;
}

export function classifySecretsError(error: unknown): GithubSecretsErrorKind {
  const status = getGitHubHttpStatus(error);
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const headers =
    error && typeof error === "object"
      ? (error as { response?: { headers?: Record<string, string> } }).response
          ?.headers
      : undefined;

  if (
    status === 429 ||
    headers?.["x-ratelimit-remaining"] === "0" ||
    headers?.["retry-after"] ||
    message.includes("rate limit") ||
    message.includes("rate limited")
  ) {
    return "github_rate_limited";
  }

  if (
    (status === 403 && message.includes("resource not accessible")) ||
    message.includes("secrets")
  ) {
    return "app_no_secrets_permission";
  }

  if (status === 401 || status === 403) {
    return "app_no_secrets_permission";
  }

  return "github_error";
}

export function statusForSecretsErrorKind(errorKind: GithubSecretsErrorKind) {
  switch (errorKind) {
    case "secret_name_invalid":
      return 400;
    case "secret_too_large":
      return 413;
    case "github_rate_limited":
      return 429;
    case "github_not_connected":
    case "no_installation":
    case "app_no_access":
    case "repo_access_denied":
    case "app_no_secrets_permission":
      return 403;
    case "github_error":
      return 502;
  }
}
