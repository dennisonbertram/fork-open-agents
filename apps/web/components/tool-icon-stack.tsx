"use client";

import { Github, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ToolIconItem = {
  name: string;
  icon: ReactNode;
  label: string;
};

const DEFAULT_TOOLKIT_ICONS: Record<string, ReactNode> = {
  github: <Github className="size-3" />,
  jira: (
    <span className="flex size-3 items-center justify-center text-[10px] font-bold leading-none">
      J
    </span>
  ),
};

function getToolkitIcon(slug: string): ReactNode {
  const lower = slug.toLowerCase();
  if (lower === "github") {
    return DEFAULT_TOOLKIT_ICONS.github;
  }
  if (lower === "jira") {
    return DEFAULT_TOOLKIT_ICONS.jira;
  }
  return <Wrench className="size-3" />;
}

function formatToolName(slug: string): string {
  const cleaned = slug.trim().replace(/[_-]+/g, " ").trim();
  if (!cleaned) {
    return slug;
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

interface ToolIconStackProps {
  items: ToolIconItem[];
  maxVisible?: number;
}

export function ToolIconStack({ items, maxVisible = 3 }: ToolIconStackProps) {
  const visible = items.slice(0, maxVisible);
  const overflow = items.length - maxVisible;

  if (items.length === 0) {
    return (
      <div className="flex items-center" aria-label="No tools connected">
        <div
          className={cn(
            "flex size-4 items-center justify-center rounded-full",
            "bg-muted/50 text-muted-foreground",
          )}
        >
          <Wrench className="size-2.5" />
        </div>
      </div>
    );
  }

  const labels = items.map((item) => item.label).join(", ");

  return (
    <div className="flex items-center" aria-label={`Active tools: ${labels}`}>
      {visible.map((item, index) => (
        <div
          key={`${item.name}-${index}`}
          className={cn(
            "flex size-4 items-center justify-center rounded-full",
            "border border-border bg-background text-foreground",
            index > 0 && "-ml-1",
          )}
          style={{ zIndex: visible.length - index }}
          title={item.label}
        >
          {item.icon}
        </div>
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            "-ml-1 flex size-4 items-center justify-center rounded-full",
            "bg-muted text-[8px] font-medium text-muted-foreground",
          )}
          style={{ zIndex: 0 }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

/** Build a ToolIconItem list from toolkit slugs, deduplicating against a native indicator. */
export function buildToolIconItems(params: {
  activeToolkits: string[];
  /** Whether the session has native GitHub access (repo connected + GitHub App installed). */
  githubConnected: boolean;
}): ToolIconItem[] {
  const items: ToolIconItem[] = [];

  // Native GitHub indicator first
  if (params.githubConnected) {
    items.push({
      name: "github-native",
      icon: <Github className="size-3" />,
      label: "GitHub (native)",
    });
  }

  for (const slug of params.activeToolkits) {
    // Deduplicate: if GitHub is already shown as native, skip the Composio github slug
    if (params.githubConnected && slug.toLowerCase() === "github") {
      continue;
    }
    items.push({
      name: slug,
      icon: getToolkitIcon(slug),
      label: formatToolName(slug),
    });
  }

  return items;
}
