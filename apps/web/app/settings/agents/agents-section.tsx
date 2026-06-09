"use client";

import Link from "next/link";
import { SettingsSection } from "@/components/ui/settings-section";
import type { AgentRosterRow } from "./agents-roster";

/** Map each role to a subtitle shown beneath the role name in the card. */
const ROLE_SUBTITLES: Record<AgentRosterRow["key"], string> = {
  main: "Chat coordinator",
  explorer: "Subagent",
  executor: "Subagent",
  design: "Subagent",
};

function FieldCell({
  label,
  value,
  hint,
  editLabel,
  editHref,
}: {
  label: string;
  value: string;
  hint?: string;
  editLabel: string;
  editHref: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium">{value}</span>
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
      <Link
        href={editHref}
        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {editLabel} &rarr;
      </Link>
    </div>
  );
}

function AgentCard({ row }: { row: AgentRosterRow }) {
  const subtitle = ROLE_SUBTITLES[row.key];
  const modelValue = row.modelInherited
    ? "Inherits Main"
    : (row.model ?? "Default");

  return (
    <SettingsSection
      title={`${row.name} · ${subtitle}`}
      description={row.description}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FieldCell
          label="Model"
          value={modelValue}
          editLabel="Edit in Models"
          editHref="/settings/models"
        />
        <FieldCell
          label="External tools"
          value={row.toolsLabel === "None" ? "None connected" : row.toolsLabel}
          hint="Built-in file editing & commands are always on."
          editLabel="Edit in Composio"
          editHref="/settings/composio"
        />
        <FieldCell
          label="Skills"
          value={row.skillsLabel}
          editLabel="Edit in Skills"
          editHref="/settings/skills"
        />
        <FieldCell
          label="Runtime"
          value={row.runtimeLabel}
          editLabel="Edit in Preferences"
          editHref="/settings/preferences"
        />
      </div>
    </SettingsSection>
  );
}

export function AgentsSection({ rows }: { rows: AgentRosterRow[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Editing agents here is coming soon &mdash; for now use the linked
        settings.
      </p>
      <div className="space-y-4">
        {rows.map((row) => (
          <AgentCard key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
}

export function AgentsSectionSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-36 animate-pulse rounded-xl border border-border bg-muted"
        />
      ))}
    </div>
  );
}
