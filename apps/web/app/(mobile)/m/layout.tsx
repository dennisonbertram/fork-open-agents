import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getServerSession } from "@/lib/session/get-server-session";

type MobileLayoutProps = {
  children: ReactNode;
};

/**
 * Mobile route-group layout.
 *
 * - Async server component: checks auth via getServerSession, redirects to /
 *   if unauthenticated. Guards every /m/* route — the tabbed pages AND the
 *   pushed chat route.
 * - The bottom tab bar lives in the nested (tabs) layout, so the pushed Chat
 *   route renders full-screen with its own pinned composer and no tab bar
 *   overlapping it.
 * - Does NOT re-wrap with <Providers>; those are injected by the root layout.
 *
 * #793: a signed-out visitor to a `/m/*` deep link (e.g. a shared chat link)
 * must not lose that destination on the way through sign-in. `proxy.ts`
 * stamps the incoming pathname+search onto the `x-invoke-path` request
 * header for every `/m/*` request (Server Components have no other way to
 * read the current path), and this layout forwards it as a `next` query
 * param on the redirect target so `/` can carry it into the sign-in CTA.
 */
export default async function MobileLayout({ children }: MobileLayoutProps) {
  const session = await getServerSession();

  if (!session?.user) {
    const requestHeaders = await headers();
    const originalPath = requestHeaders.get("x-invoke-path");
    redirect(originalPath ? `/?next=${encodeURIComponent(originalPath)}` : "/");
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">{children}</div>
  );
}
