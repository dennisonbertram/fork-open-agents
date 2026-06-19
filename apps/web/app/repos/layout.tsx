import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SessionsRouteShell } from "@/app/sessions/sessions-route-shell";
import { getLastRepoByUserId } from "@/lib/db/last-repo";
import {
  getArchivedSessionCountByUserId,
  getSessionsWithUnreadByUserId,
} from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";

type ReposLayoutProps = {
  children: ReactNode;
};

/**
 * Repo routes (e.g. the repo dashboard) render INSIDE the same app shell as
 * sessions — keeping the sessions sidebar so a repo dashboard stays in context
 * of the selected repo instead of opening as a standalone full-screen window.
 */
export default async function ReposLayout({ children }: ReposLayoutProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const [lastRepo, sessions, archivedCount] = await Promise.all([
    getLastRepoByUserId(session.user.id),
    getSessionsWithUnreadByUserId(session.user.id, { status: "active" }),
    getArchivedSessionCountByUserId(session.user.id),
  ]);

  return (
    <SessionsRouteShell
      currentUser={session.user}
      initialSessionsData={{ sessions, archivedCount }}
      lastRepo={lastRepo}
    >
      {children}
    </SessionsRouteShell>
  );
}
