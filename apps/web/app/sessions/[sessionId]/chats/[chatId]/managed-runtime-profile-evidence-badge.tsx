"use client";

import type { ManagedRuntimeProfileOption } from "@/app/api/sessions/[sessionId]/managed-runtime/profiles/route";
import { cn } from "@/lib/utils";

/**
 * Widens `ManagedRuntimeProfileOption` with the persisted test-scope field
 * (Decision D6). The scope lives on `managed_runtime_saved_profiles`
 * (`last_test_scope`, MR-1) but the profiles-list route (out of this
 * ticket's file territory) does not yet surface it on the option type, so
 * this badge accepts it as an optional local extension until that route is
 * updated to include it.
 */
export type ManagedRuntimeProfileEvidence = ManagedRuntimeProfileOption & {
  lastTestScope?: "verify" | "setup_and_verify" | null;
};

export function ManagedRuntimeProfileEvidenceBadge({
  profile,
}: {
  profile: ManagedRuntimeProfileEvidence;
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
  profile: ManagedRuntimeProfileEvidence,
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
    // Decision D6: only a setup_and_verify pass earns the "Tested" badge. A
    // verify-only pass is real evidence (the current sandbox verified),
    // but it never proves the profile's setup commands work, so it must
    // not be labeled "Tested".
    if (profile.lastTestScope === "verify") {
      return {
        label: "Verified on current sandbox — setup not tested",
        title: profile.testedAt
          ? `Verified ${formatManagedRuntimeProfileTestTime(profile.testedAt)} on the current sandbox; setup commands were not run`
          : "Verification commands passed on the current sandbox; setup commands were not run",
        className:
          "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
    }

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
  profile: ManagedRuntimeProfileEvidence | undefined,
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
