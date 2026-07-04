import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Blocks,
  Bot,
  Boxes,
  Cable,
  Cpu,
  FolderGit2,
  Lightbulb,
  Server,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  User,
  Users,
} from "lucide-react";
import type { Metadata } from "next";

export type SettingsRouteAudience = "user" | "admin";

export type SettingsRouteId =
  | "admin"
  | "agents"
  | "background-agents"
  | "composio"
  | "connections"
  | "learnings"
  | "leaderboard"
  | "mcp"
  | "models"
  | "preferences"
  | "profile"
  | "repositories"
  | "runtime-profiles"
  | "skills"
  | "usage";

export interface SettingsRouteMetadata {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  audience: SettingsRouteAudience;
}

export const SETTINGS_ROUTE_METADATA = {
  profile: {
    title: "Profile",
    description:
      "Review your identity, activity, usage, and leaderboard position.",
    href: "/settings/profile",
    icon: User,
    audience: "user",
  },
  preferences: {
    title: "Preferences",
    description:
      "Tune how Open Agents behaves for you. Changes apply to new chats right away.",
    href: "/settings/preferences",
    icon: SlidersHorizontal,
    audience: "user",
  },
  connections: {
    title: "Connections",
    description: "Link the accounts Open Agents uses to act on your behalf.",
    href: "/settings/connections",
    icon: Cable,
    audience: "user",
  },
  agents: {
    title: "Agents",
    description:
      "Agents are the AI roles that work inside your chats, from Main to helper subagents.",
    href: "/settings/agents",
    icon: Users,
    audience: "user",
  },
  models: {
    title: "Models",
    description:
      "Pick the models your agents use and create named setups for specific jobs.",
    href: "/settings/models",
    icon: Boxes,
    audience: "user",
  },
  composio: {
    title: "Composio",
    description:
      "Connect external tools like Gmail, Slack, and Linear so your chats and background agents can use them.",
    href: "/settings/composio",
    icon: Blocks,
    audience: "user",
  },
  mcp: {
    title: "MCP servers",
    description:
      "Connect Model Context Protocol servers so their tools can be used by your agents.",
    href: "/settings/mcp",
    icon: Server,
    audience: "user",
  },
  skills: {
    title: "Skills",
    description: "Author reusable instructions your agents can run like tools.",
    href: "/settings/skills",
    icon: Sparkles,
    audience: "user",
  },
  "background-agents": {
    title: "Background agents",
    description:
      "Configure triggered agents that run on their own in a repository.",
    href: "/settings/background-agents",
    icon: Bot,
    audience: "user",
  },
  repositories: {
    title: "Repositories",
    description:
      "Per-repository defaults and tool access, including which tools agents can use in each repository.",
    href: "/settings/repositories",
    icon: FolderGit2,
    audience: "user",
  },
  "runtime-profiles": {
    title: "Runtime profiles",
    description:
      "Create reusable sandbox toolchains and setup commands for new sessions.",
    href: "/settings/runtime-profiles",
    icon: Cpu,
    audience: "user",
  },
  usage: {
    title: "Usage",
    description:
      "See how much you've used Open Agents across tokens, cost, and repositories.",
    href: "/settings/usage",
    icon: BarChart3,
    audience: "user",
  },
  learnings: {
    title: "Learnings",
    description:
      "Durable patterns, gotchas, and conventions your repos have learned from pull requests.",
    href: "/settings/learnings",
    icon: Lightbulb,
    audience: "user",
  },
  leaderboard: {
    title: "Leaderboard",
    description: "Internal organization leaderboard ranked by token usage.",
    href: "/settings/leaderboard",
    icon: Trophy,
    audience: "user",
  },
  admin: {
    title: "Admin",
    description:
      "Operator tools for managing tokens and access across the workspace.",
    href: "/settings/admin",
    icon: ShieldAlert,
    audience: "admin",
  },
} satisfies Record<SettingsRouteId, SettingsRouteMetadata>;

export function getSettingsRouteMetadata(routeId: SettingsRouteId) {
  return SETTINGS_ROUTE_METADATA[routeId];
}

export function toNextMetadata(routeId: SettingsRouteId): Metadata {
  const route = getSettingsRouteMetadata(routeId);
  return {
    title: route.title,
    description: route.description,
  };
}
