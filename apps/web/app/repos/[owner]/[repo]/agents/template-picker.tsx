"use client";

import { ArrowRight, FileText } from "lucide-react";
import {
  triggerLabels,
  type TriggerKind,
} from "@/lib/background-agents/agent-spec";
import {
  AGENT_TEMPLATES,
  getBlankTemplate,
  type AgentTemplate,
  type BlankTemplate,
} from "./agent-templates";

type TemplateLike = AgentTemplate | BlankTemplate;

type TemplatePickerProps = {
  onSelect: (template: TemplateLike) => void;
};

/**
 * Renders the 5 named agent templates plus a blank option.
 * Repo owner/name are NOT shown here — they are fixed by the route params.
 */
export function TemplatePicker({ onSelect }: TemplatePickerProps) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {AGENT_TEMPLATES.map((template) => {
          const triggerLabel =
            triggerLabels[template.triggerKind as TriggerKind] ??
            template.triggerKind;

          return (
            <button
              key={template.name}
              type="button"
              className="flex flex-col items-start gap-2 rounded-md border border-border bg-muted/20 p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
              onClick={() => onSelect(template)}
            >
              <div className="flex w-full items-start justify-between gap-2">
                <p className="text-sm font-medium">{template.name}</p>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">{template.goal}</p>
              <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {triggerLabel}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border bg-transparent p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/20"
          onClick={() => onSelect(getBlankTemplate())}
        >
          <div className="flex w-full items-start justify-between gap-2">
            <p className="text-sm font-medium">Blank</p>
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground">
            Start from scratch with an empty spec.
          </p>
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Select a template to review and edit the spec before saving.
      </p>
    </div>
  );
}
