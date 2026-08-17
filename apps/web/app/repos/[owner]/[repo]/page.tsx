import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { verifyRepoAccess } from "@/lib/github/access";
import { resolveRepoAccessPageOutcome } from "@/lib/github/repo-page-access";
import { getServerSession } from "@/lib/session/get-server-session";
import { loadRepositoryDashboardSummary } from "./repository-dashboard-summary";
import {
  RepositoryDashboardAccessError,
  RepositoryDashboardView,
} from "./repository-dashboard-view";

export const metadata: Metadata = {
  title: "Repository",
  description: "Repository context for Sessions, Automations, and Runs.",
};

type RepoDashboardPageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function RepoDashboardPage({
  params,
}: RepoDashboardPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const { owner, repo } = await params;
  let access: Awaited<ReturnType<typeof verifyRepoAccess>>;
  try {
    access = await verifyRepoAccess({
      userId: session.user.id,
      owner,
      repo,
      requiredUserPermission: "read",
    });
  } catch {
    return <RepositoryDashboardAccessError owner={owner} repo={repo} />;
  }
  if (!access.ok) {
    // Not every denial is "this repo does not exist for you". An expired
    // token, a rate limit, or a missing App installation are all fixable, and
    // answering them with a 404 leaves the user no route back.
    if (resolveRepoAccessPageOutcome(access.reason) === "actionable") {
      return <RepositoryDashboardAccessError owner={owner} repo={repo} />;
    }
    notFound();
  }

  const summary = await loadRepositoryDashboardSummary({
    userId: session.user.id,
    owner,
    repo,
  });
  return (
    <RepositoryDashboardView owner={owner} repo={repo} summary={summary} />
  );
}
