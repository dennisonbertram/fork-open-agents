"use client";

import type { ManagedRuntimeProfileOption } from "@/app/api/sessions/[sessionId]/managed-runtime/profiles/route";
import { cn } from "@/lib/utils";

export function ManagedRuntimeProfileEvidenceBadge({
  profile,
}: {
  profile: ManagedRuntimeProfileOption;
}) {
  const view = getManagedRuntimeProfileEvidenceBadgeView(profile);
  if (!view) {
    return null;
  }

  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none",
        view.className,
      )}
      title={view.title}
    >
      {view.label}
    </span>
  );
}

export function getManagedRuntimeProfileEvidenceBadgeView(
  profile: ManagedRuntimeProfileOption,
): {
  label: string;
  title: string;
  className: string;
} | null {
  if (profile.source !== "session") {
    return null;
  }

  const status = profile.testStatus ?? "untested";
  if (status === "passed") {
    return {
      label: "Tested",
      title: profile.testedAt
        ? `Tested ${formatManagedRuntimeProfileTestTime(profile.testedAt)}`
        : "The source draft passed a sandbox test",
      className:
        "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }

  if (status === "failed") {
    return {
      label: "Needs changes",
      title: "The source draft had failing test evidence",
      className: "border-destructive/20 bg-destructive/10 text-destructive",
    };
  }

  return {
    label: "Untested",
    title: "The source draft has not passed a sandbox test",
    className:
      "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  };
}

export function getManagedRuntimeProfileEvidenceSummary(
  profile: ManagedRuntimeProfileOption | undefined,
): string {
  if (!profile) {
    return "No managed runtime profile is selected yet.";
  }
  if (profile.source !== "session") {
    return "This is a built-in profile maintained by Open Agents.";
  }

  const status = profile.testStatus ?? "untested";
  if (status === "passed") {
    return profile.testedAt
      ? `This custom profile passed sandbox testing at ${formatManagedRuntimeProfileTestTime(profile.testedAt)}.`
      : "This custom profile passed sandbox testing.";
  }
  if (status === "failed") {
    return "This custom profile has failing source-draft evidence; inspect it before using it for new setup.";
  }
  return "This custom profile has not passed a sandbox test yet.";
}

function formatManagedRuntimeProfileTestTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
