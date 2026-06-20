import type { DashboardErrorKind } from "../repo-dashboard";

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

export function classifyActionsReadError(error: unknown): DashboardErrorKind {
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

  if (status === 403 && message.includes("resource not accessible")) {
    return "app_no_actions_permission";
  }

  if (status === 401 || status === 403) {
    return "repo_access_denied";
  }

  if (status === 404) {
    return "invalid_repo";
  }

  if (status && status >= 500) {
    return "provider_unavailable";
  }

  return "provider_unavailable";
}

export function classifyActionsMutationError(
  error: unknown,
): DashboardErrorKind {
  const status = getGitHubHttpStatus(error);
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const headers =
    error && typeof error === "object"
      ? (error as { response?: { headers?: Record<string, string> } }).response
          ?.headers
      : undefined;

  if (
    status === 429 ||
    (status === 403 &&
      (headers?.["retry-after"] ||
        message.includes("rate limit") ||
        message.includes("rate limited") ||
        message.includes("secondary rate")))
  ) {
    return "github_rate_limited";
  }

  if (status === 403 && message.includes("resource not accessible")) {
    return "app_no_actions_permission";
  }

  if (status === 422 && message.includes("cancel")) {
    return "run_not_cancellable";
  }

  if (status === 422) {
    return "github_error";
  }

  if (status === 401 || status === 403) {
    return "repo_access_denied";
  }

  return "github_error";
}

export function statusForDashboardErrorKind(errorKind: DashboardErrorKind) {
  switch (errorKind) {
    case "github_rate_limited":
      return 429;
    case "github_not_connected":
    case "unauthenticated":
      return 401;
    case "workflow_not_on_default_branch":
    case "dispatch_input_invalid":
    case "run_not_cancellable":
      return 422;
    case "repo_access_denied":
    case "installation_missing":
    case "no_installation":
    case "app_no_access":
    case "app_no_actions_permission":
      return 403;
    case "invalid_repo":
      return 404;
    case "github_error":
      return 502;
    default:
      return 502;
  }
}
