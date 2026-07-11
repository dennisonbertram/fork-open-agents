"use client";

import {
  Activity,
  FolderGit2,
  MessageSquare,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type WorkspaceNavigationId =
  | "sessions"
  | "runs"
  | "automations"
  | "repositories"
  | "settings";

export type WorkspaceNavigationItem = {
  id: WorkspaceNavigationId;
  label: string;
  ariaLabel: string;
  href: string;
  icon: LucideIcon;
};

const WORKSPACE_NAVIGATION_ITEMS = [
  {
    id: "sessions",
    label: "Sessions",
    ariaLabel: "Sessions",
    href: "/sessions",
    icon: MessageSquare,
  },
  {
    id: "runs",
    label: "Runs",
    ariaLabel: "Runs",
    href: "/runs",
    icon: Activity,
  },
  {
    id: "automations",
    label: "Automations",
    ariaLabel: "Automations",
    href: "/automations",
    icon: Workflow,
  },
  {
    id: "repositories",
    label: "Repositories",
    ariaLabel: "Repositories",
    href: "/repos",
    icon: FolderGit2,
  },
  {
    id: "settings",
    label: "Settings",
    ariaLabel: "Settings",
    href: "/settings",
    icon: Settings,
  },
] as const satisfies readonly WorkspaceNavigationItem[];

export function getWorkspaceNavigationItems(): WorkspaceNavigationItem[] {
  return [...WORKSPACE_NAVIGATION_ITEMS];
}

function pathnameSegments(pathname: string): string[] {
  return pathname.split(/[?#]/, 1)[0]?.split("/").filter(Boolean) ?? [];
}

function isSegment(segments: string[], index: number, value: string): boolean {
  return segments[index] === value;
}

export function getActiveWorkspaceNavigationItem(
  pathname: string,
): WorkspaceNavigationItem | null {
  const segments = pathnameSegments(pathname);
  const itemById = new Map(
    WORKSPACE_NAVIGATION_ITEMS.map((item) => [item.id, item]),
  );

  if (isSegment(segments, 0, "sessions")) {
    return itemById.get("sessions") ?? null;
  }

  const isLegacyLoopRun =
    segments.length >= 4 &&
    isSegment(segments, 0, "loops") &&
    isSegment(segments, 2, "runs");
  if (
    isSegment(segments, 0, "runs") ||
    isSegment(segments, 0, "background-runs") ||
    isLegacyLoopRun
  ) {
    return itemById.get("runs") ?? null;
  }

  const repoCompatibilitySurface = segments[3];
  const isLegacyRepoAutomation =
    isSegment(segments, 0, "repos") &&
    (repoCompatibilitySurface === "agents" ||
      repoCompatibilitySurface === "project" ||
      repoCompatibilitySurface === "loops");
  const isLegacySettingsAutomation =
    isSegment(segments, 0, "settings") &&
    isSegment(segments, 1, "background-agents");
  if (
    isSegment(segments, 0, "automations") ||
    isSegment(segments, 0, "loops") ||
    isLegacyRepoAutomation ||
    isLegacySettingsAutomation
  ) {
    return itemById.get("automations") ?? null;
  }

  if (isSegment(segments, 0, "repos")) {
    return itemById.get("repositories") ?? null;
  }

  if (isSegment(segments, 0, "settings")) {
    return itemById.get("settings") ?? null;
  }

  return null;
}

export type WorkspaceNavigationMode = "expanded" | "collapsed" | "mobile";

type WorkspaceNavigationProps = {
  mode: WorkspaceNavigationMode;
  pathname: string;
  onNavigate?: () => void;
  className?: string;
};

export function WorkspaceNavigation({
  mode,
  pathname,
  onNavigate,
  className,
}: WorkspaceNavigationProps) {
  const activeItem = getActiveWorkspaceNavigationItem(pathname);
  const collapsed = mode === "collapsed";

  return (
    <nav
      aria-label="Workspace navigation"
      className={cn(
        collapsed
          ? "flex w-full flex-col items-center gap-1"
          : "flex w-full flex-col gap-1",
        className,
      )}
    >
      {getWorkspaceNavigationItems().map((item) => {
        const Icon = item.icon;
        const active = item.id === activeItem?.id;
        const link = (
          <Link
            key={item.id}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            aria-label={collapsed ? item.ariaLabel : undefined}
            data-navigation-tooltip={collapsed ? "" : undefined}
            className={cn(
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              collapsed
                ? "flex size-9 items-center justify-center rounded-md"
                : "flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {collapsed ? null : <span data-navigation-label>{item.label}</span>}
          </Link>
        );

        if (!collapsed) {
          return link;
        }

        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              {item.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}
