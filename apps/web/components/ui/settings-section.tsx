"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SettingsPageHeaderProps {
  title: string;
  /** One-line, plain-language summary of what this page is for. */
  description?: string;
  /** Optional right-aligned control (rare). */
  action?: React.ReactNode;
}

/**
 * One per settings page. Replaces ad-hoc inline `<h1 className="text-2xl …">`
 * headers so every page reads the same: a title plus a plain-language summary.
 */
export function SettingsPageHeader({ title, description, action }: SettingsPageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-pretty text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export interface SettingsSectionProps {
  /** A noun, e.g. "Default models", "Personal API keys". */
  title: string;
  /** The effect in plain language (≤120 chars). */
  description?: string;
  /** Right-aligned control slot: a Switch, Select, or "Edit" button. */
  action?: React.ReactNode;
  /** Inline learn-more. Only rendered when an href is provided. */
  learnMore?: { href: string; label?: string };
  /** Power/expert config, rendered inside a labelled disclosure that is closed by default. */
  advanced?: { label?: string; children: React.ReactNode };
  /** Visual emphasis. "danger" fences destructive blocks in a red border. */
  tone?: "default" | "danger";
  children?: React.ReactNode;
}

/**
 * One per logical block within a settings page. Gives every section a consistent
 * title + one-line "why" + optional learn-more, with power config tucked behind a
 * labelled "Advanced" disclosure so the common path stays calm.
 */
export function SettingsSection({
  title,
  description,
  action,
  learnMore,
  advanced,
  tone = "default",
  children,
}: SettingsSectionProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm",
        tone === "danger" ? "border-destructive/30 bg-destructive/[0.03]" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 className={cn("text-sm font-medium", tone === "danger" && "text-destructive")}>
            {title}
          </h2>
          {description ? (
            <p className="text-pretty text-sm text-muted-foreground">
              {description}
              {learnMore ? (
                <>
                  {" "}
                  <a
                    href={learnMore.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
                  >
                    {learnMore.label ?? "Learn more"}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {children ? <div className="mt-4">{children}</div> : null}

      {advanced ? (
        <div className="mt-4 border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            {advanced.label ?? "Advanced"}
          </button>
          {open ? <div className="mt-3">{advanced.children}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
