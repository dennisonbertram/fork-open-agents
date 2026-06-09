"use client";

import { ChevronDown, RefreshCw } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export type ReadinessStatus = "ready" | "action-needed" | "unavailable" | "error";

export interface ReadinessCheck {
  id: string;
  /** Human label, e.g. "GitHub App installed". */
  label: string;
  status: "ready" | "missing" | "disabled";
  /** Plain explanation. */
  detail?: string;
  /** Raw env-var / service identifiers — presence only, NEVER values. */
  missing?: string[];
  present?: string[];
}

export interface ReadinessVerdictProps {
  status: ReadinessStatus;
  /** The one plain-language sentence the end user reads. Must not contain raw identifiers. */
  headline: string;
  /** Optional second line, e.g. who controls it. */
  subtext?: string;
  /** Optional inline CTA that resolves the prerequisite. */
  action?: React.ReactNode;
  /** Operator-only diagnostic detail; collapsed by default behind "Operator details". */
  checks?: ReadinessCheck[];
  onRefresh?: () => void;
  refreshing?: boolean;
}

const DOT: Record<ReadinessStatus, string> = {
  ready: "bg-emerald-500",
  "action-needed": "bg-amber-500",
  unavailable: "bg-muted-foreground/50",
  error: "bg-destructive",
};

const CHECK_DOT: Record<ReadinessCheck["status"], string> = {
  ready: "bg-emerald-500",
  missing: "bg-amber-500",
  disabled: "bg-muted-foreground/50",
};

/**
 * Translates deploy-time / environment prerequisites into a single human verdict.
 * End users see only the headline / subtext / action; raw env-var names live behind
 * the collapsed "Operator details" disclosure and are rendered presence-only.
 */
export function ReadinessVerdict({
  status,
  headline,
  subtext,
  action,
  checks,
  onRefresh,
  refreshing,
}: ReadinessVerdictProps) {
  const [open, setOpen] = React.useState(false);
  const hasChecks = Boolean(checks && checks.length > 0);

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[status])}
            aria-hidden="true"
          />
          <div className="min-w-0 space-y-0.5">
            <p className="text-pretty text-sm font-medium">{headline}</p>
            {subtext ? (
              <p className="text-pretty text-xs text-muted-foreground">{subtext}</p>
            ) : null}
            {action ? <div className="pt-1.5">{action}</div> : null}
          </div>
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh status"
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </button>
        ) : null}
      </div>

      {hasChecks ? (
        <div className="mt-3 border-t border-border/60 pt-2.5">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            Operator details
          </button>
          {open ? (
            <ul className="mt-2 space-y-2">
              {checks?.map((check) => (
                <li className="text-xs" key={check.id}>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full", CHECK_DOT[check.status])}
                      aria-hidden="true"
                    />
                    <span className="font-medium">{check.label}</span>
                  </div>
                  {check.detail ? (
                    <p className="ml-3 text-pretty text-muted-foreground">{check.detail}</p>
                  ) : null}
                  {check.present?.length || check.missing?.length ? (
                    <div className="ml-3 mt-1 flex flex-wrap gap-1">
                      {check.present?.map((name) => (
                        <span
                          className="rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700 dark:text-emerald-300"
                          key={name}
                        >
                          {name} ✓ set
                        </span>
                      ))}
                      {check.missing?.map((name) => (
                        <span
                          className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                          key={name}
                        >
                          {name} ✗ not set
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
