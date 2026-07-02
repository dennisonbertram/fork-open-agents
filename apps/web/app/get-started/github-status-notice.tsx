import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import type { GitHubConnectStatus } from "@/lib/github/connect-status";

type NoticeSeverity =
  | "success"
  | "in-progress"
  | "recoverable"
  | "operator"
  | "neutral"
  | "unknown";

type NoticeContent = {
  severity: NoticeSeverity;
  title: string;
  description: string;
  showRetry: boolean;
};

function contentFor(
  status: GitHubConnectStatus | string,
  missingInstallationId: boolean,
): NoticeContent {
  switch (status) {
    case "account_connected":
      return {
        severity: "success",
        title: "GitHub account connected",
        description: "Your GitHub account is linked.",
        showRetry: false,
      };
    case "app_installed":
      return {
        severity: "success",
        title: "GitHub App installed",
        description:
          "Repository access is now configured for the selected account.",
        showRetry: false,
      };
    case "request_sent":
      return {
        severity: "in-progress",
        title: "Installation approval pending",
        description:
          "An org admin needs to approve the installation request. This page will not update automatically — check back after it's approved.",
        showRetry: false,
      };
    case "pending_sync":
      return {
        severity: "in-progress",
        title: "Install detected, sync in progress",
        description: missingInstallationId
          ? "The app may already be installed. Refresh to re-check for it."
          : "GitHub reported the installation but syncing may take a moment. Refresh to re-check.",
        showRetry: false,
      };
    case "no_action":
      return {
        severity: "neutral",
        title: "No changes made",
        description: "You returned from GitHub without installing the app.",
        showRetry: false,
      };
    case "app_not_configured":
      return {
        severity: "operator",
        title: "GitHub App isn't configured",
        description:
          "This Open Agents deployment doesn't have a GitHub App configured yet. Contact an administrator.",
        showRetry: false,
      };
    case "not_linked":
      // No retry CTA: the "Connect GitHub" button rendered below in the
      // not-linked branch of GitHubConnectStep owns recovery for this status.
      // Linking retryHref (`/api/github/app/install`) here would bounce a
      // never-linked user straight back to `github=not_linked` — a loop.
      return {
        severity: "recoverable",
        title: "GitHub account not connected",
        description: "We couldn't confirm a linked GitHub account.",
        showRetry: false,
      };
    case "link_failed":
      // Same reasoning as not_linked: the Connect GitHub button below owns
      // recovery, so no separate (looping) retry CTA is rendered here.
      return {
        severity: "recoverable",
        title: "Failed to connect GitHub account",
        description: "Something went wrong while linking your account.",
        showRetry: false,
      };
    case "invalid_state":
      return {
        severity: "unknown",
        title: "Connection interrupted",
        description: "Something interrupted the GitHub connection. Try again.",
        showRetry: true,
      };
    default:
      return {
        severity: "unknown",
        title: "Connection interrupted",
        description: "Something interrupted the GitHub connection. Try again.",
        showRetry: true,
      };
  }
}

const SEVERITY_ROLE: Record<NoticeSeverity, "status" | "alert"> = {
  success: "status",
  "in-progress": "status",
  neutral: "status",
  operator: "alert",
  recoverable: "alert",
  unknown: "status",
};

const SEVERITY_ICON: Record<NoticeSeverity, typeof Info> = {
  success: CheckCircle2,
  "in-progress": Clock,
  neutral: Info,
  operator: AlertTriangle,
  recoverable: AlertTriangle,
  unknown: Info,
};

const SEVERITY_STYLES: Record<NoticeSeverity, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  "in-progress": "border-amber-500/30 bg-amber-500/10 text-amber-200",
  neutral: "border-white/10 bg-white/5 text-zinc-300",
  operator: "border-orange-500/30 bg-orange-500/10 text-orange-200",
  recoverable: "border-red-500/30 bg-red-500/10 text-red-200",
  unknown: "border-white/10 bg-white/5 text-zinc-300",
};

export function GitHubStatusNotice({
  status,
  retryHref,
  missingInstallationId = false,
}: {
  status: GitHubConnectStatus | string;
  retryHref: string;
  missingInstallationId?: boolean;
}) {
  const { severity, title, description, showRetry } = contentFor(
    status,
    missingInstallationId,
  );
  const role = SEVERITY_ROLE[severity];
  const Icon = SEVERITY_ICON[severity];

  return (
    <div
      role={role}
      className={`mb-4 flex items-start gap-3 rounded-lg border px-3 py-2.5 ${SEVERITY_STYLES[severity]}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs opacity-90">{description}</p>
        {showRetry && (
          <Link
            href={retryHref}
            className="inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-2 hover:opacity-80"
          >
            <RefreshCw className="size-3" />
            Try connecting again
          </Link>
        )}
      </div>
    </div>
  );
}
