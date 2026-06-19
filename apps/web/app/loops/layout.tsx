import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SessionsRouteShell } from "@/app/sessions/sessions-route-shell";
import { getLastRepoByUserId } from "@/lib/db/last-repo";
import {
  getArchivedSessionCountByUserId,
  getSessionsWithUnreadByUserId,
} from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";

type LoopsLayoutProps = {
  children: ReactNode;
};

/**
 * Loop routes (list, detail, builder, runs) render INSIDE the same app shell as
 * sessions and repos — keeping the workspace sidebar so loops stay in context
 * instead of opening as standalone full-screen pages.
 */
export default async function LoopsLayout({ children }: LoopsLayoutProps) {
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
