"use client";

import { ArrowLeft, LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/lib/auth/actions";
import { useSession } from "@/hooks/use-session";
import { AuthGuard } from "@/components/auth/auth-guard";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountsSectionSkeleton } from "./accounts-section";
import { AgentsSectionSkeleton } from "./agents/agents-section";
import { ComposioSectionSkeleton } from "./composio-section";
import { InferenceProfilesSectionSkeleton } from "./inference-profiles-section";
import { LeaderboardSectionSkeleton } from "./leaderboard-section";
import { ModelVariantsSectionSkeleton } from "./model-variants-section";
import { findActiveNavItem } from "./nav-items";
import { PreferencesSectionSkeleton } from "./preferences-section";
import { SettingsNav } from "./settings-nav";

/** Skeleton shown while auth is loading for the combined profile page */
function ProfilePageSkeleton() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
      <div className="w-full shrink-0 lg:w-56">
        <div className="space-y-6">
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-20 w-20 rounded-full" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-6">
        <Skeleton className="h-[96px] w-full rounded-md" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

function ConnectionsPageSkeleton() {
  return <AccountsSectionSkeleton />;
}

function SettingsLayout({
  children,
  pathname,
  isAdmin,
}: {
  children: React.ReactNode;
  pathname: string;
  isAdmin: boolean;
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const activeItem = findActiveNavItem(pathname);

  const navItems = (
    <SettingsNav
      pathname={pathname}
      isAdmin={isAdmin}
      onNavigate={() => setMobileSidebarOpen(false)}
    />
  );

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 border-r border-border md:flex">
        <div className="flex h-full w-full flex-col overflow-y-auto">
          <div className="flex items-center gap-4 px-6 py-4">
            <Link
              href="/sessions"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </div>
          <nav className="flex-1 px-2 py-2">{navItems}</nav>
          <div className="border-t border-border px-2 py-3">
            <button
              type="button"
              onClick={signOut}
              className="flex w-full items-center gap-3 rounded-md px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="flex w-64 flex-col p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Settings navigation</SheetTitle>
          </SheetHeader>
          <div className="flex items-center gap-4 px-6 py-4">
            <Link
              href="/sessions"
              onClick={() => setMobileSidebarOpen(false)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </div>
          <nav className="flex-1 px-2 py-2">{navItems}</nav>
          <div className="border-t border-border px-2 py-3">
            <button
              type="button"
              onClick={signOut}
              className="flex w-full items-center gap-3 rounded-md px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Menu className="h-4 w-4" />
          </button>
          <span className="flex-1 truncate text-sm font-medium">
            {activeItem?.label ?? "Settings"}
          </span>
        </div>
        <div className="mx-auto max-w-5xl space-y-6 px-3 py-8 md:px-4 md:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAdmin } = useSession();
  const activeItem = findActiveNavItem(pathname);
  const fallbackTitle = activeItem?.label ?? "Profile";
  const fallbackContent =
    activeItem?.id === "connections" ? (
      <ConnectionsPageSkeleton />
    ) : activeItem?.id === "agents" ? (
      <AgentsSectionSkeleton />
    ) : activeItem?.id === "composio" ? (
      <ComposioSectionSkeleton />
    ) : activeItem?.id === "preferences" ? (
      <PreferencesSectionSkeleton />
    ) : activeItem?.id === "models" ? (
      <div className="space-y-6">
        <InferenceProfilesSectionSkeleton />
        <ModelVariantsSectionSkeleton />
      </div>
    ) : activeItem?.id === "leaderboard" ? (
      <LeaderboardSectionSkeleton />
    ) : (
      <ProfilePageSkeleton />
    );

  return (
    <AuthGuard
      loadingFallback={
        <SettingsLayout pathname={pathname} isAdmin={false}>
          <h1 className="text-2xl font-semibold">{fallbackTitle}</h1>
          {fallbackContent}
        </SettingsLayout>
      }
    >
      <SettingsLayout pathname={pathname} isAdmin={isAdmin}>
        {children}
      </SettingsLayout>
    </AuthGuard>
  );
}
