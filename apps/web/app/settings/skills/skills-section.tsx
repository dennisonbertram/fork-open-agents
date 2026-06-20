"use client";

import { Pencil, Plus, Sparkles, Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fetcher } from "@/lib/swr";
import {
  type EditableSkill,
  SkillEditorDialog,
  type SkillEditorSubmit,
} from "./skill-editor-dialog";
import { SettingsSectionHeader } from "../_components/section-header";

type SkillListItem = EditableSkill & { enabled: boolean };

interface SkillsResponse {
  skills: SkillListItem[];
}

const EMPTY_SKILLS: SkillListItem[] = [];

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function SkillCard({
  skill,
  isBusy,
  onToggleEnabled,
  onEdit,
  onDelete,
}: {
  skill: SkillListItem;
  isBusy: boolean;
  onToggleEnabled: (skill: SkillListItem) => void;
  onEdit: (skill: SkillListItem) => void;
  onDelete: (skill: SkillListItem) => void;
}) {
  const toolCount = skill.allowedTools.length;

  return (
    <div
      className={`group relative rounded-lg border border-border bg-card transition-colors hover:border-border/80 hover:bg-accent/30 ${
        skill.enabled ? "" : "opacity-60"
      }`}
    >
      <div className="flex items-start gap-3 p-3.5">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/70">
          <Sparkles className="size-3.5 text-muted-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-mono text-sm font-medium leading-tight">
              /{skill.name}
            </h3>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {skill.description}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {skill.source === "generated" ? (
              <Chip>
                <Sparkles className="size-2.5" />
                AI draft
              </Chip>
            ) : null}
            {skill.disableModelInvocation ? <Chip>Manual only</Chip> : null}
            {skill.userInvocable ? null : <Chip>No /slash</Chip>}
            {toolCount > 0 ? (
              <Chip>
                <Wrench className="size-2.5" />
                {toolCount === 1 ? "1 tool" : `${toolCount} tools`}
              </Chip>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => onEdit(skill)}
                  disabled={isBusy}
                  className="size-7"
                >
                  <Pencil className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit skill</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => onDelete(skill)}
                  disabled={isBusy}
                  className="size-7 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete skill</TooltipContent>
            </Tooltip>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Switch
                  checked={skill.enabled}
                  onCheckedChange={() => onToggleEnabled(skill)}
                  disabled={isBusy}
                  aria-label={skill.enabled ? "Disable skill" : "Enable skill"}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {skill.enabled ? "Enabled for your agents" : "Disabled"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

export function SkillsSectionSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-8 w-28" />
      </div>
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
    </div>
  );
}

export function SkillsSection() {
  const { data, isLoading, mutate } = useSWR<SkillsResponse>(
    "/api/settings/skills",
    fetcher,
  );

  const skills = data?.skills ?? EMPTY_SKILLS;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillListItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenCreate = () => {
    setEditingSkill(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (skill: SkillListItem) => {
    setEditingSkill(skill);
    setDialogOpen(true);
  };

  const handleSubmit = async (
    value: SkillEditorSubmit,
  ): Promise<true | string> => {
    setIsSaving(true);
    setError(null);
    try {
      const method = editingSkill ? "PATCH" : "POST";
      const payload = editingSkill ? { id: editingSkill.id, ...value } : value;
      const response = await fetch("/api/settings/skills", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const responseData = (await response.json()) as { error?: string };
      if (!response.ok) {
        return responseData.error ?? "Failed to save skill";
      }
      await mutate();
      toast.success(editingSkill ? "Skill saved" : "Skill created");
      return true;
    } catch (submitError) {
      console.error("Failed to save skill:", submitError);
      return "Failed to save skill";
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnabled = async (skill: SkillListItem) => {
    setError(null);
    try {
      const response = await fetch("/api/settings/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: skill.id, enabled: !skill.enabled }),
      });
      if (!response.ok) {
        const responseData = (await response.json()) as { error?: string };
        setError(responseData.error ?? "Failed to update skill");
        return;
      }
      await mutate();
    } catch (toggleError) {
      console.error("Failed to toggle skill:", toggleError);
      setError("Failed to update skill");
    }
  };

  const handleDelete = async (skill: SkillListItem) => {
    if (!window.confirm(`Delete the "/${skill.name}" skill?`)) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/skills", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: skill.id }),
      });
      if (!response.ok) {
        const responseData = (await response.json()) as { error?: string };
        setError(responseData.error ?? "Failed to delete skill");
        return;
      }
      await mutate();
      toast.success("Skill deleted");
    } catch (deleteError) {
      console.error("Failed to delete skill:", deleteError);
      setError("Failed to delete skill");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <SkillsSectionSkeleton />;
  }

  return (
    <>
      <div className="space-y-4">
        <SettingsSectionHeader
          title="Your skills"
          description="Reusable instructions your agents can run like tools. Enabled skills are available in every new chat."
          action={
            skills.length > 0 ? (
              <Button
                size="sm"
                onClick={handleOpenCreate}
                disabled={isSaving}
                className="shrink-0"
              >
                <Plus className="size-3.5" />
                New skill
              </Button>
            ) : null
          }
        />

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        {skills.length === 0 ? (
          <Empty className="border border-dashed border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Sparkles />
              </EmptyMedia>
              <EmptyTitle>No skills yet</EmptyTitle>
              <EmptyDescription>
                Create a reusable instruction your agents can run, or let AI
                draft one for you.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={handleOpenCreate}>
                <Plus className="size-3.5" />
                New skill
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isBusy={isSaving}
                onToggleEnabled={handleToggleEnabled}
                onEdit={handleOpenEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      <SkillEditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingSkill={editingSkill}
        isSaving={isSaving}
        onSubmit={handleSubmit}
      />
    </>
  );
}
