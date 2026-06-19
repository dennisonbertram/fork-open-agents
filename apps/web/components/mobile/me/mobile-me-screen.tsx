"use client";

import { LogOut, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth/client";
import { useSession } from "@/hooks/use-session";
import { MobileScreenHeader } from "@/components/mobile/shell/mobile-screen-header";
import { MobileThemeToggle } from "./theme-toggle";

/**
 * Mobile Me screen — profile, theme, and sign-out.
 *
 * Reads the current session via useSession() and signs out via
 * authClient.signOut() before redirecting to "/".
 */
export function MobileMeScreen() {
  const router = useRouter();
  const { session } = useSession();

  const user = session?.user;

  async function handleSignOut() {
    await authClient.signOut();
    router.replace("/");
  }

  // Derive avatar fallback initials
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0] ?? "")
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : (user?.username?.[0]?.toUpperCase() ?? "?");

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <MobileScreenHeader title="Me" />

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom,0px),24px)] pt-6">
        {/* Profile card */}
        <div
          className={cn(
            "flex items-center gap-4 rounded-2xl border border-border bg-card p-4",
          )}
        >
          <Avatar className="h-14 w-14 shrink-0">
            {user?.avatar ? (
              <AvatarImage
                src={user.avatar}
                alt={user.name ?? user.username ?? "Profile"}
              />
            ) : null}
            <AvatarFallback className="bg-muted text-muted-foreground">
              {user ? (
                initials
              ) : (
                <User className="h-6 w-6" aria-hidden="true" />
              )}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            {user?.name ? (
              <p className="truncate text-base font-semibold text-foreground">
                {user.name}
              </p>
            ) : null}
            {user?.username ? (
              <p className="truncate text-sm text-muted-foreground">
                @{user.username}
              </p>
            ) : null}
            {user?.email ? (
              <p className="truncate text-xs text-muted-foreground">
                {user.email}
              </p>
            ) : null}
            {!user && (
              <p className="text-sm text-muted-foreground">Not signed in</p>
            )}
          </div>
        </div>

        {/* Appearance */}
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-foreground">Appearance</p>
          <MobileThemeToggle />
        </div>

        <Separator className="my-1" />

        {/* Sign out */}
        {user ? (
          <Button
            variant="outline"
            className="min-h-[44px] w-full gap-2 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleSignOut}
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            Sign out
          </Button>
        ) : null}
      </div>
    </div>
  );
}
