import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadRepositoryDirectory } from "@/lib/github/repository-directory";
import { getServerSession } from "@/lib/session/get-server-session";
import { RepositoryDirectoryView } from "./repository-directory-view";

export const metadata: Metadata = {
  title: "Repositories",
  description:
    "Open a repository workspace for Sessions, Automations, and Runs.",
};

export default async function ReposPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const snapshot = await loadRepositoryDirectory(session.user.id);
  return <RepositoryDirectoryView snapshot={snapshot} />;
}
