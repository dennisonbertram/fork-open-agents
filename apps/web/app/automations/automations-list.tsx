"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  ChevronRight,
  ListFilter,
  Plus,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type {
  AutomationFilters,
  AutomationListItem,
  AutomationSourceStatus,
  ListAutomationsResponse,
} from "@/lib/automations/types";
import {
  canonicalNewAutomationUrl,
  canonicalNewLoopAutomationUrl,
} from "@/lib/automations/definition-routes";
import { cn } from "@/lib/utils";

type AutomationsListProps = {
  response: ListAutomationsResponse;
  filters: AutomationFilters;
};

function formatDate(value: string | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function filterRepositoryValue(filters: AutomationFilters): string {
  return filters.repository
    ? `${filters.repository.owner}/${filters.repository.name}`
    : "";
}

function createLinks(filters: AutomationFilters) {
  if (!filters.repository) {
    return {
      single: canonicalNewAutomationUrl(),
      multi: canonicalNewLoopAutomationUrl(),
    };
  }
  return {
    single: canonicalNewAutomationUrl(filters.repository),
    multi: canonicalNewLoopAutomationUrl(filters.repository),
  };
}

function kindLabel(kind: AutomationListItem["kind"]): string {
  return kind === "single_step" ? "Single step" : "Multi-step";
}

function sourceLabel(source: AutomationListItem["source"]): string {
  return source === "background_agent" ? "Background agent" : "Agent loop";
}

function statusClass(item: AutomationListItem): string {
  if (item.operability === "active") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (item.nativeStatus === "paused" || item.nativeStatus === "draft") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-border bg-muted/40 text-muted-foreground";
}

function SourceNotice({ status }: { status: AutomationSourceStatus }) {
  if (status.status === "ok") return null;
  if (status.status === "disabled") {
    return (
      <p>
        Multi-step automations are disabled in this deployment. Single-step
        automations remain available.
      </p>
    );
  }
  const label =
    status.source === "background_agent" ? "Single-step" : "Multi-step";
  if (status.status === "failed") {
    return <p>{label} automations are temporarily unavailable.</p>;
  }
  return (
    <p>
      {label} automations include {status.invalidItemCount} configuration
      {status.invalidItemCount === 1 ? "" : "s"} that could not be fully read.
    </p>
  );
}

function TriggerSummary({ item }: { item: AutomationListItem }) {
  if (item.triggers.total === 0) {
    return <span>No triggers configured</span>;
  }
  const label = item.triggers.labels.join(" · ");
  return (
    <span>
      {item.triggers.enabled}/{item.triggers.total} triggers enabled
      {label ? ` · ${label}` : ""}
    </span>
  );
}

function AutomationCard({ item }: { item: AutomationListItem }) {
  return (
    <li className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={item.detailUrl}
              className="truncate text-sm font-semibold hover:underline"
            >
              {item.name}
            </Link>
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {kindLabel(item.kind)}
            </span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
                statusClass(item),
              )}
            >
              {item.nativeStatus}
            </span>
            {item.configurationHealth === "invalid" ? (
              <span className="rounded-full border border-red-500/25 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">
                Needs attention
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {item.repository.owner}/{item.repository.name}
          </p>
          {item.description ? (
            <p className="mt-2 line-clamp-2 text-pretty text-sm text-muted-foreground">
              {item.description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={item.editUrl}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/40"
          >
            Edit
          </Link>
          <Link
            href={item.detailUrl}
            aria-label={`Open ${item.name}`}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 border-t border-border pt-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Steps</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {item.stepCount ?? "Unknown"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Verification</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {item.verification.configuredStepCount === null
              ? "Unknown"
              : `${item.verification.configuredStepCount}/${item.verification.totalVerifiableSteps ?? 0} configured`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Next run</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {formatDate(item.triggers.nextRunAt)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Latest run</dt>
          <dd className="mt-1 font-medium">
            {item.latestRun ? (
              <Link
                href={item.latestRun.detailUrl}
                className="inline-flex items-center gap-1 hover:underline"
              >
                {item.latestRun.outcome ?? item.latestRun.state}
                <ArrowUpRight className="size-3" />
              </Link>
            ) : (
              "No runs yet"
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <TriggerSummary item={item} />
        <span>
          Source: {sourceLabel(item.source)} · Updated{" "}
          {formatDate(item.updatedAt)}
        </span>
      </div>
    </li>
  );
}

export function AutomationsList({ response, filters }: AutomationsListProps) {
  const router = useRouter();
  const links = createLinks(filters);
  const loopsDisabled = response.sourceStatus.some(
    (status) => status.source === "agent_loop" && status.status === "disabled",
  );
  const activeFilters = Boolean(
    filters.repository || filters.kind || filters.state,
  );
  const notices = response.sourceStatus.filter(
    (status) => status.status !== "ok",
  );
  const hasBlockingSourceGap = response.sourceStatus.some(
    (status) => status.status === "failed" || status.status === "partial",
  );
  const filteredOrIncomplete = activeFilters || hasBlockingSourceGap;
  const allUnavailable =
    response.sourceStatus.some((status) => status.status === "failed") &&
    response.sourceStatus.every(
      (status) => status.status === "failed" || status.status === "disabled",
    );

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div className="min-w-0">
            <nav
              aria-label="Automation breadcrumb"
              className="mb-3 flex items-center gap-1.5 text-sm"
            >
              <Link
                href="/sessions"
                className="text-muted-foreground hover:text-foreground"
              >
                Workspace
              </Link>
              <ChevronRight className="size-3.5 text-muted-foreground" />
              <span className="font-medium">Automations</span>
            </nav>
            <h1 className="text-balance text-2xl font-semibold">Automations</h1>
            <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">
              Trigger durable coding work with a single agent or an advanced
              multi-step sequence.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {loopsDisabled ? (
              <span
                aria-disabled="true"
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-medium text-muted-foreground"
              >
                <Workflow className="size-4" />
                Multi-step unavailable
              </span>
            ) : (
              <Link
                href={links.multi}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted/40"
              >
                <Workflow className="size-4" />
                Multi-step
              </Link>
            )}
            <Link
              href={links.single}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="size-4" />
              New automation
            </Link>
          </div>
        </header>

        <form
          method="get"
          aria-label="Filter automations"
          className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_180px_180px_auto]"
        >
          <label className="grid gap-1.5 text-xs font-medium">
            Repository
            <select
              name="repository"
              defaultValue={filterRepositoryValue(filters)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All repositories</option>
              {response.facets.repositories.map((repository) => {
                const value = `${repository.owner}/${repository.name}`;
                return (
                  <option key={value.toLowerCase()} value={value}>
                    {value}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Type
            <select
              name="kind"
              defaultValue={filters.kind ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All types</option>
              <option value="single_step">Single step</option>
              <option value="multi_step">Multi-step</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Status
            <select
              name="state"
              defaultValue={filters.state ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm capitalize"
            >
              <option value="">All statuses</option>
              {response.facets.states.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted/40"
            >
              <ListFilter className="size-4" />
              Apply
            </button>
            {activeFilters ? (
              <Link
                href="/automations"
                className="inline-flex h-9 items-center rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        {notices.length > 0 ? (
          <div
            role="status"
            className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1 text-pretty">
              {notices.map((status) => (
                <SourceNotice key={status.source} status={status} />
              ))}
            </div>
          </div>
        ) : null}

        {allUnavailable ? (
          <section className="rounded-lg border border-red-500/25 bg-red-500/10 p-8 text-center">
            <AlertTriangle className="mx-auto size-5 text-red-700 dark:text-red-300" />
            <h2 className="mt-3 text-balance text-sm font-semibold">
              Automations could not be loaded
            </h2>
            <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-muted-foreground">
              The definition sources are unavailable. Retry this page; no
              configuration was changed.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => router.refresh()}
            >
              Retry this page
            </Button>
          </section>
        ) : response.automations.length === 0 ? (
          <section className="rounded-lg border border-dashed border-border p-10 text-center">
            <Bot className="mx-auto size-5 text-muted-foreground" />
            <h2 className="mt-3 text-balance text-sm font-semibold">
              {filteredOrIncomplete
                ? "No automations match these filters"
                : "No automations configured"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-muted-foreground">
              {filteredOrIncomplete
                ? "Clear the filters or retry after the unavailable source recovers."
                : "Create a single-step automation to review pull requests, implement issues, or respond to webhooks."}
            </p>
            <Link
              href={filteredOrIncomplete ? "/automations" : links.single}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {filteredOrIncomplete ? null : <Plus className="size-4" />}
              {activeFilters
                ? "Clear filters"
                : hasBlockingSourceGap
                  ? "Retry automations"
                  : "Create automation"}
            </Link>
          </section>
        ) : (
          <section aria-labelledby="automation-results-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2
                id="automation-results-heading"
                className="text-balance text-sm font-semibold"
              >
                {response.total} automation{response.total === 1 ? "" : "s"}
              </h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                Request {response.requestId.slice(0, 8)}
              </span>
            </div>
            <ul className="space-y-3">
              {response.automations.map((item) => (
                <AutomationCard key={item.id} item={item} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
