import type { ReactNode } from "react";

export interface SettingsSectionHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  help?: ReactNode;
}

export function SettingsSectionHeader({
  title,
  description,
  action,
  help,
}: SettingsSectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1.5">
        <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          {title}
        </h3>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
        {help}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
