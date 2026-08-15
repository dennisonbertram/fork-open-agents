"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Github, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { AuthCtaError } from "@/components/auth/auth-cta-error";
import { ProductJourney } from "@/components/product-journey";
import { authClient } from "@/lib/auth/client";
import { runAuthCta } from "@/lib/auth/run-auth-cta";
import type { GitHubConnectStatus } from "@/lib/github/connect-status";
import { sanitizeInternalRedirect } from "@/lib/redirect-safety";
import { GitHubStatusNotice } from "./github-status-notice";

export const GITHUB_LINK_ERROR_MESSAGE = "Couldn't connect GitHub. Try again.";

function OpenAgentsLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-label="Open Agents"
    >
      <path
        d="M4 17L10 11L4 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 19H20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function GetStartedFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    session,
    loading: sessionLoading,
    hasGitHubAccount,
    hasGitHubInstallations,
  } = useSession();
  const githubStatus = searchParams.get("github") as GitHubConnectStatus | null;
  const missingInstallationId =
    searchParams.get("missing_installation_id") === "1";
  // Reconnect intent must be explicit: `step=github` alone only means
  // "auto-open the GitHub step" (see below) — it does not imply the user's
  // GitHub connection is broken. Only an explicit `reconnect=1` (set by
  // `buildGitHubReconnectUrl`) forces the reconnect flow.
  const isGitHubReconnect = searchParams.get("reconnect") === "1";
  const redirectPath = sanitizeInternalRedirect(
    searchParams.get("next"),
    "/sessions",
  );
  // Issue #842 (finding 4): the onboarding gate (requireOnboarded) redirects
  // here with an explicit `next` param, so a user bounced off /sessions lands
  // on a bare setup flow with no explanation. Show a one-line reason whenever
  // `next` is present.
  const arrivedFromGate = searchParams.get("next") !== null;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* left panel */}
      <div className="flex shrink-0 flex-col justify-between bg-black px-6 py-6 md:w-1/2 md:px-12 md:py-10">
        <div className="flex items-center gap-3">
          <OpenAgentsLogo className="size-7 text-white/50" />
          <span className="text-lg font-semibold tracking-tight text-white/50">
            Open Agents
          </span>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-zinc-600">
          Connect GitHub, start a durable Session, create an Automation, and
          inspect the resulting Run.
        </p>
        <div className="mt-8 text-white">
          <ProductJourney dark linked />
        </div>
      </div>

      {/* right panel */}
      <div className="flex flex-1 flex-col bg-zinc-950 px-6 py-8 md:px-10 md:py-10">
        <div className="flex w-full flex-1 flex-col">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-white">
            Get Started
          </h1>
          {arrivedFromGate ? (
            <p className="mb-4 text-sm text-zinc-500">
              Finish setup to continue to your sessions.
            </p>
          ) : (
            <div className="mb-6" />
          )}

          <div className="flex-1 space-y-6">
            <section aria-labelledby="auth-prerequisite-heading">
              <p className="text-xs font-medium uppercase text-zinc-500">
                Authentication prerequisite
              </p>
              <h2
                id="auth-prerequisite-heading"
                className="mt-1 text-sm font-medium text-zinc-300"
              >
                Signed in with Vercel
              </h2>
              <div className="mt-3">
                <VercelAccountPrerequisite
                  session={session}
                  loading={sessionLoading}
                />
              </div>
            </section>

            <section
              aria-labelledby="github-step-heading"
              className="border-t border-white/10 pt-4"
            >
              <div className="flex items-center gap-3 text-white">
                <span className="text-sm tabular-nums">1.</span>
                {/* Issue #842 (finding 5): the heading, description, and action
                    button must not all repeat "Connect GitHub" — the heading
                    uses the plain account name while the button carries the
                    verb. */}
                <h2 id="github-step-heading" className="text-sm font-medium">
                  GitHub
                </h2>
              </div>
              <div className="pt-4">
                <GitHubConnectStep
                  session={session}
                  loading={sessionLoading}
                  hasGitHubAccount={hasGitHubAccount}
                  hasGitHubInstallations={hasGitHubInstallations}
                  forceReconnect={isGitHubReconnect}
                  redirectPath={redirectPath}
                  githubStatus={githubStatus}
                  missingInstallationId={missingInstallationId}
                  onComplete={() => router.push(redirectPath)}
                />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function VercelAccountPrerequisite({
  session,
  loading,
}: {
  session: ReturnType<typeof useSession>["session"];
  loading: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-10 w-full rounded bg-white/5" />;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        Signed in via Vercel. This account is used for authentication.
      </p>
      <div className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2.5">
        <div className="flex items-center gap-3">
          {session?.user?.avatar ? (
            <Image
              src={session.user.avatar}
              alt=""
              width={32}
              height={32}
              className="size-8 rounded-full bg-zinc-800"
            />
          ) : (
            <div className="size-8 rounded-full bg-zinc-800" />
          )}
          <div>
            <p className="text-sm font-medium text-zinc-200">
              {session?.user?.name ?? session?.user?.username ?? "Vercel"}
            </p>
            {session?.user?.email && (
              <p className="text-xs text-zinc-600">{session.user.email}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GitHubConnectStep({
  session,
  loading,
  hasGitHubAccount,
  hasGitHubInstallations,
  forceReconnect,
  redirectPath,
  githubStatus,
  missingInstallationId,
  onComplete,
}: {
  session: ReturnType<typeof useSession>["session"];
  loading: boolean;
  hasGitHubAccount: boolean;
  hasGitHubInstallations: boolean;
  forceReconnect: boolean;
  redirectPath: string;
  githubStatus: GitHubConnectStatus | null;
  missingInstallationId: boolean;
  onComplete: () => void;
}) {
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const isConnected =
    !forceReconnect && hasGitHubAccount && hasGitHubInstallations;
  const shouldShowInstallStep =
    !forceReconnect && hasGitHubAccount && !hasGitHubInstallations;
  const githubInstallHref = `/api/github/app/install?next=${encodeURIComponent(redirectPath)}`;
  const githubPostLinkCallback = `/api/github/post-link?next=${encodeURIComponent(redirectPath)}`;

  const statusNotice = githubStatus ? (
    <GitHubStatusNotice
      status={githubStatus}
      retryHref={githubInstallHref}
      missingInstallationId={missingInstallationId}
    />
  ) : null;

  if (loading) {
    return <Skeleton className="h-10 w-full rounded bg-white/5" />;
  }

  if (isConnected) {
    return (
      <div className="space-y-3">
        {statusNotice}
        <div className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2.5">
          <div className="flex items-center gap-3">
            {session?.user?.avatar ? (
              <Image
                src={session.user.avatar}
                alt=""
                width={32}
                height={32}
                className="size-8 rounded-full bg-zinc-800"
              />
            ) : (
              <div className="flex size-8 items-center justify-center rounded-full bg-zinc-800">
                <Github className="size-4 text-zinc-400" />
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-zinc-200">
                GitHub connected
              </p>
              {session?.user?.username && (
                <p className="text-xs text-zinc-600">
                  @{session.user.username}
                </p>
              )}
            </div>
          </div>
          <Check className="size-4 text-emerald-400" strokeWidth={2.5} />
        </div>
        <Button
          size="sm"
          onClick={onComplete}
          className="gap-2 bg-white text-black hover:bg-zinc-200"
        >
          {redirectPath === "/sessions" ? "Start a Session" : "Continue"}
        </Button>
      </div>
    );
  }

  if (shouldShowInstallStep) {
    // linked but no app installed
    return (
      <div className="space-y-3">
        {statusNotice}
        <p className="text-xs text-zinc-500">
          Your GitHub identity is verified. Next, install the Open Agents GitHub
          App to grant repo access — you can choose selected repositories
          instead of every repository in your account.
        </p>
        <Button
          asChild
          variant="outline"
          className="gap-2 border-zinc-700 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white"
        >
          <Link href={githubInstallHref}>
            <Github className="size-4" />
            Install GitHub App
          </Link>
        </Button>
      </div>
    );
  }

  // not linked
  const handleLinkGitHub = () =>
    runAuthCta({
      cta: "github_link_get_started",
      errorMessage: GITHUB_LINK_ERROR_MESSAGE,
      action: () =>
        authClient.linkSocial({
          provider: "github",
          callbackURL: githubPostLinkCallback,
        }),
      setPending: setIsLinking,
      setError: setLinkError,
    });

  return (
    <div className="space-y-3">
      {statusNotice}
      <p className="text-xs text-zinc-500">
        {forceReconnect
          ? "Reconnect your GitHub account to restore repository and installation access."
          : "First you'll verify your identity, then install the Open Agents GitHub App and choose which repositories it can access."}
      </p>
      <Button
        variant="outline"
        disabled={isLinking}
        onClick={() => void handleLinkGitHub()}
        className="gap-2 border-zinc-700 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white"
      >
        {isLinking ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Github className="size-4" />
        )}
        {forceReconnect ? "Reconnect GitHub" : "Connect GitHub"}
      </Button>
      {linkError ? (
        <AuthCtaError
          message={linkError}
          onRetry={() => void handleLinkGitHub()}
        />
      ) : null}
    </div>
  );
}
