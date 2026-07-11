"use client";

import { LogOut, Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { signOut } from "@/lib/auth/actions";
import { useSession } from "@/hooks/use-session";
import { AuthGuard } from "@/components/auth/auth-guard";
import {
  getActiveWorkspaceNavigationItem,
  WorkspaceNavigation,
} from "@/components/workspace-navigation";
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
import {
  findActiveNavItem,
  resolveSettingsFallbackRouteId,
  visibleNavGroups,
} from "./nav-items";
import { PreferencesSectionSkeleton } from "./preferences-section";
import { SettingsPageHeader } from "./_components/page-header";
import { getSettingsRouteMetadata } from "./settings-routes";
import { SettingsNav } from "./settings-nav";
import { SkillsSectionSkeleton } from "./skills/skills-section";

function RuntimeProfilesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <Skeleton className="mb-4 h-4 w-32" />
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      </div>
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <Skeleton className="mb-4 h-4 w-32" />
        <Skeleton className="h-12 w-full rounded-md" />
      </div>
    </div>
  );
}

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
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const activeItem = findActiveNavItem(pathname, visibleNavGroups(isAdmin));
  const activeWorkspaceItem = getActiveWorkspaceNavigationItem(pathname);

  function closeMobileSidebar() {
    setMobileSidebarOpen(false);
    requestAnimationFrame(() => mobileTriggerRef.current?.focus());
  }

  const navItems = (
    <SettingsNav
      pathname={pathname}
      isAdmin={isAdmin}
      onNavigate={closeMobileSidebar}
    />
  );

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 border-r border-border md:flex">
        <div className="flex h-full w-full flex-col overflow-y-auto">
          <div className="border-b border-border p-2">
            <WorkspaceNavigation mode="expanded" pathname={pathname} />
          </div>
          <nav aria-label="Settings navigation" className="flex-1 px-2 py-2">
            {navItems}
          </nav>
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

      <Sheet
        open={mobileSidebarOpen}
        onOpenChange={(open) => {
          setMobileSidebarOpen(open);
          if (!open) {
            closeMobileSidebar();
          }
        }}
      >
        <SheetContent side="left" className="flex w-64 flex-col p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Settings navigation</SheetTitle>
          </SheetHeader>
          <div className="border-b border-border p-2">
            <WorkspaceNavigation
              mode="mobile"
              pathname={pathname}
              onNavigate={closeMobileSidebar}
            />
          </div>
          <nav
            aria-label="Settings navigation"
            className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
          >
            {navItems}
          </nav>
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
            ref={mobileTriggerRef}
            onClick={() => setMobileSidebarOpen(true)}
            className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open workspace navigation"
          >
            <Menu className="h-4 w-4" />
          </button>
          <span className="flex-1 truncate text-sm font-medium">
            {activeWorkspaceItem?.id === "automations"
              ? activeWorkspaceItem.label
              : (activeItem?.label ?? "Settings")}
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
  const fallbackGroups = visibleNavGroups(false);
  const activeItem = findActiveNavItem(pathname, fallbackGroups);
  const fallbackRouteId = resolveSettingsFallbackRouteId(
    pathname,
    fallbackGroups,
  );
  const fallbackRoute = getSettingsRouteMetadata(fallbackRouteId);
  const fallbackContent =
    activeItem?.id === "connections" ? (
      <ConnectionsPageSkeleton />
    ) : activeItem?.id === "agents" ? (
      <AgentsSectionSkeleton />
    ) : activeItem?.id === "composio" ? (
      <ComposioSectionSkeleton />
    ) : activeItem?.id === "skills" ? (
      <SkillsSectionSkeleton />
    ) : activeItem?.id === "preferences" ? (
      <PreferencesSectionSkeleton />
    ) : activeItem?.id === "models" ? (
      <div className="space-y-6">
        <InferenceProfilesSectionSkeleton />
        <ModelVariantsSectionSkeleton />
      </div>
    ) : activeItem?.id === "leaderboard" ? (
      <LeaderboardSectionSkeleton />
    ) : activeItem?.id === "runtime-profiles" ? (
      <RuntimeProfilesSkeleton />
    ) : (
      <ProfilePageSkeleton />
    );

  return (
    <AuthGuard
      loadingFallback={
        <SettingsLayout pathname={pathname} isAdmin={false}>
          <SettingsPageHeader
            title={fallbackRoute.title}
            description={fallbackRoute.description}
          />
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
