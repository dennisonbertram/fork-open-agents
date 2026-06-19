import type { ReactNode } from "react";
import { MobileTabBar } from "@/components/mobile/shell/mobile-tab-bar";

type MobileTabsLayoutProps = {
  children: ReactNode;
};

/**
 * Layout for the bottom-tab destinations (Activity, New, Me).
 *
 * Provides the scrollable content area plus the fixed MobileTabBar. The pushed
 * Chat route lives OUTSIDE this group (directly under m/), so it renders
 * full-screen with its own pinned composer and no tab bar overlapping it.
 *
 * Auth is enforced by the parent m/layout, so this layout stays presentational.
 */
export default function MobileTabsLayout({ children }: MobileTabsLayoutProps) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      {/*
        pb-20 + the safe-area inset keep content from being hidden behind the
        fixed tab bar / iOS home indicator.
      */}
      <main className="flex-1 overflow-x-hidden overflow-y-auto pb-20">
        {children}
      </main>

      <MobileTabBar />
    </div>
  );
}
