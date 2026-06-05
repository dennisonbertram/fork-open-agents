"use client";

import type {
  RunSummary,
  RunSummaryArtifact,
} from "@/lib/background-agents/run-summary";

type RunSummarySectionProps = {
  summary: RunSummary;
};

function SummaryList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div>
      <p className="text-[10px] font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <ul className="mt-1 space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-sm">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArtifactItem({ artifact }: { artifact: RunSummaryArtifact }) {
  const inner = <span className="text-sm">{artifact.label}</span>;
  return (
    <li>
      {artifact.url ? (
        <a
          href={artifact.url}
          className="inline-flex items-center gap-1 text-sm hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          {inner}
        </a>
      ) : (
        inner
      )}
    </li>
  );
}

export function RunSummarySection({ summary }: RunSummarySectionProps) {
  return (
    <section className="rounded-md border border-border">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Run summary</h2>
      </div>
      <div className="space-y-4 px-4 py-3">
        <p className="font-medium text-sm">{summary.headline}</p>
        <SummaryList label="Checked" items={summary.checked} />
        <SummaryList label="Changed" items={summary.changed} />
        {summary.blocked.length > 0 && (
          <div>
            <p className="text-[10px] font-medium uppercase text-muted-foreground">
              Blocked
            </p>
            <ul className="mt-1 space-y-0.5">
              {summary.blocked.map((item, i) => (
                <li key={i} className="text-sm text-red-700 dark:text-red-300">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        {summary.artifacts.length > 0 && (
          <div>
            <p className="text-[10px] font-medium uppercase text-muted-foreground">
              Artifacts
            </p>
            <ul className="mt-1 space-y-0.5">
              {summary.artifacts.map((artifact, i) => (
                <ArtifactItem key={i} artifact={artifact} />
              ))}
            </ul>
          </div>
        )}
        <SummaryList label="Next" items={summary.next} />
      </div>
    </section>
  );
}
