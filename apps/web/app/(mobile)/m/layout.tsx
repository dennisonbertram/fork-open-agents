import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getServerSession } from "@/lib/session/get-server-session";
import { MobileTabBar } from "@/components/mobile/shell/mobile-tab-bar";

type MobileLayoutProps = {
  children: ReactNode;
};

/**
 * Mobile route-group layout.
 *
 * - Async server component: checks auth via getServerSession, redirects to /
 *   if unauthenticated.
 * - Wraps all /m/* routes in a full-height safe-area-padded container.
 * - Renders MobileTabBar fixed at the bottom.
 * - Does NOT re-wrap with <Providers>; those are injected by the root layout.
 */
export default async function MobileLayout({ children }: MobileLayoutProps) {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/");
  }

  return (
    <div className="relative flex min-h-dvh flex-col bg-background text-foreground">
      {/*
        Scrollable content area.
        pb-[env(safe-area-inset-bottom)] and the explicit pb-20 ensure that
        content is never hidden behind the fixed tab bar or the home indicator
        on iOS.
      */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-20">
        {children}
      </main>

      {/* Fixed bottom tab bar */}
      <MobileTabBar />
    </div>
  );
}
