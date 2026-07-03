export type GitHubConnectionStatus =
  | "not_connected"
  | "connected"
  | "reconnect_required"
  | "sync_degraded";

export type GitHubConnectionReason =
  | "token_unavailable"
  | "installations_missing"
  | "sync_auth_failed"
  | "sync_unknown_error";

export interface GitHubConnectionStatusResponse {
  status: GitHubConnectionStatus;
  reason: GitHubConnectionReason | null;
  hasInstallations: boolean;
  syncedInstallationsCount: number | null;
}
