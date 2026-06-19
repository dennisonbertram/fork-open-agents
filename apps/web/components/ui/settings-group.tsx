import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface SettingsGroupProps extends React.ComponentProps<"section"> {
  title: string;
  description?: string;
  tone?: "default" | "danger";
}

export function SettingsGroup({
  title,
  description,
  tone = "default",
  className,
  children,
  ...props
}: SettingsGroupProps) {
  return (
    <section
      data-slot="settings-group"
      data-tone={tone}
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-sm",
        tone === "danger" && "border-destructive/30 bg-destructive/[0.03]",
        className,
      )}
      {...props}
    >
      <div
        data-slot="settings-group-header"
        className={cn(
          "space-y-1 border-b px-5 py-4",
          tone === "danger" && "border-destructive/20",
        )}
      >
        <h3
          className={cn(
            "text-sm font-medium",
            tone === "danger" && "text-destructive",
          )}
        >
          {title}
        </h3>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div data-slot="settings-group-rows" className="divide-y divide-border">
        {children}
      </div>
    </section>
  );
}

export interface SettingRowProps extends React.ComponentProps<"div"> {
  label: string;
  description?: string;
  htmlFor?: string;
  /** Optional className forwarded to the control-slot wrapper div. */
  controlClassName?: string;
  children?: React.ReactNode;
}

export function SettingRow({
  label,
  description,
  htmlFor,
  controlClassName,
  className,
  children,
  ...props
}: SettingRowProps) {
  const descId = React.useId();

  // Determine whether we have a single React element child so we can
  // safely clone it and inject aria-describedby. Fragments, arrays, and
  // non-elements are left as-is (no crash, description still rendered).
  const singleElement =
    description &&
    React.Children.count(children) === 1 &&
    React.isValidElement(children)
      ? (children as React.ReactElement<Record<string, unknown>>)
      : null;

  const controlChild =
    singleElement && description
      ? React.cloneElement(singleElement, {
          "aria-describedby": singleElement.props["aria-describedby"]
            ? `${singleElement.props["aria-describedby"]} ${descId}`
            : descId,
        })
      : children;

  return (
    <div
      data-slot="setting-row"
      className={cn(
        "flex flex-col items-start gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 space-y-0.5">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </Label>
        ) : (
          <span className="text-sm font-medium">{label}</span>
        )}
        {description ? (
          <p
            id={descId}
            className="text-pretty text-sm text-muted-foreground"
          >
            {description}
          </p>
        ) : null}
      </div>
      {children ? (
        <div
          data-slot="setting-row-control"
          className={cn("shrink-0", controlClassName)}
        >
          {controlChild}
        </div>
      ) : null}
    </div>
  );
}
