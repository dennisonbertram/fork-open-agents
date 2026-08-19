"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { readApiError } from "@/lib/api/read-api-error";
import { skillNameSchema, slugifySkillName } from "@/lib/skills/skill-types";

export type SkillEditorSubmit = {
  name: string;
  description: string;
  body: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  allowedTools: string[];
  source: "manual" | "generated";
};

export type EditableSkill = {
  id: string;
  name: string;
  description: string;
  body: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  allowedTools: string[];
  source: "manual" | "generated";
};

type GenerateSkillResponse = {
  skill?: { name: string; description: string; body: string };
  error?: string;
};

function parseAllowedTools(input: string): string[] {
  return input
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
}

export function SkillEditorDialog({
  open,
  onOpenChange,
  editingSkill,
  isSaving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingSkill: EditableSkill | null;
  isSaving: boolean;
  onSubmit: (value: SkillEditorSubmit) => Promise<true | string>;
}) {
  const isEditing = editingSkill !== null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [disableModelInvocation, setDisableModelInvocation] = useState(false);
  const [userInvocable, setUserInvocable] = useState(true);
  const [allowedToolsText, setAllowedToolsText] = useState("");
  const [source, setSource] = useState<"manual" | "generated">("manual");
  const [error, setError] = useState<string | null>(null);

  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (editingSkill) {
      setName(editingSkill.name);
      setDescription(editingSkill.description);
      setBody(editingSkill.body);
      setDisableModelInvocation(editingSkill.disableModelInvocation);
      setUserInvocable(editingSkill.userInvocable);
      setAllowedToolsText(editingSkill.allowedTools.join(", "));
      setSource(editingSkill.source);
    } else {
      setName("");
      setDescription("");
      setBody("");
      setDisableModelInvocation(false);
      setUserInvocable(true);
      setAllowedToolsText("");
      setSource("manual");
    }
    setAiPrompt("");
    setError(null);
  }, [open, editingSkill]);

  const handleGenerate = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch("/api/settings/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await response
        .json()
        .catch(() => null)) as GenerateSkillResponse | null;
      if (!response.ok || !data?.skill) {
        const apiError = readApiError(
          data,
          "Couldn't generate a draft. Try again.",
        );
        toast.error(
          typeof apiError.retryAfterSeconds === "number"
            ? `${apiError.message} — try again in ${apiError.retryAfterSeconds}s`
            : apiError.message,
        );
        return;
      }
      if (!name.trim()) {
        setName(data.skill.name);
      }
      setDescription(data.skill.description);
      setBody(data.skill.body);
      setSource("generated");
      setError(null);
      toast.success("Draft generated. Review and tweak before saving.");
    } catch {
      toast.error("Couldn't generate a draft. Try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const nameResult = skillNameSchema.safeParse(name.trim());
    if (!nameResult.success) {
      setError(nameResult.error.issues[0]?.message ?? "Invalid skill name");
      return;
    }
    if (!description.trim()) {
      setError("Description is required");
      return;
    }
    if (!body.trim()) {
      setError("Instructions are required");
      return;
    }

    setError(null);
    const result = await onSubmit({
      name: nameResult.data,
      description: description.trim(),
      body: body.trim(),
      disableModelInvocation,
      userInvocable,
      allowedTools: parseAllowedTools(allowedToolsText),
      source,
    });

    if (result === true) {
      onOpenChange(false);
    } else {
      setError(result);
    }
  };

  const busy = isSaving || isGenerating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit skill" : "New skill"}</DialogTitle>
          <DialogDescription>
            A skill is a reusable instruction your agents can run, like a tool.
            Write it yourself or generate a draft with AI.
          </DialogDescription>
        </DialogHeader>

        {/* AI draft panel */}
        <div className="mt-4 rounded-lg border border-primary/25 bg-primary/[0.04] p-3.5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-medium">Generate with AI</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Describe what the skill should do and we&apos;ll draft the name,
            description, and instructions for you to refine.
          </p>
          <Textarea
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            placeholder="e.g. Review a React component for accessibility issues and suggest fixes"
            className="mt-2 min-h-16 resize-y text-sm"
            disabled={busy}
          />
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleGenerate}
              disabled={busy || aiPrompt.trim().length === 0}
            >
              {isGenerating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {isGenerating ? "Generating…" : "Generate draft"}
            </Button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="skill-name" className="text-xs font-medium">
              Name
            </Label>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm text-muted-foreground">/</span>
              <Input
                id="skill-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() =>
                  setName((current) =>
                    current.trim() ? slugifySkillName(current) : current,
                  )
                }
                placeholder="code-review"
                className="font-mono"
                disabled={busy}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Lowercase letters, numbers, and hyphens. Used to invoke the skill
              as <code className="font-mono">/{name.trim() || "name"}</code>.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="skill-description" className="text-xs font-medium">
              Description
            </Label>
            <Input
              id="skill-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="When should an agent reach for this skill?"
              disabled={busy}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="skill-body" className="text-xs font-medium">
              Instructions
            </Label>
            <Textarea
              id="skill-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={
                "# What to do\n\nStep-by-step instructions the agent follows when this skill runs."
              }
              className="min-h-48 resize-y font-mono text-xs leading-relaxed"
              disabled={busy}
            />
            <p className="text-[11px] text-muted-foreground">
              Markdown. This becomes the body of the skill the agent reads.
            </p>
          </div>

          {/* Invocation options */}
          <div className="space-y-3 rounded-lg border border-border/70 p-3.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Invocation
            </p>
            <div className="flex items-start justify-between gap-4">
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">
                  Model can invoke automatically
                </span>
                <span className="block text-xs text-muted-foreground">
                  Let the agent run this skill on its own when relevant.
                </span>
              </span>
              <Switch
                aria-label="Model can invoke automatically"
                checked={!disableModelInvocation}
                onCheckedChange={(checked) =>
                  setDisableModelInvocation(!checked)
                }
                disabled={busy}
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">
                  Invocable with /slash
                </span>
                <span className="block text-xs text-muted-foreground">
                  Let you trigger it directly by typing its name.
                </span>
              </span>
              <Switch
                aria-label="Invocable with a slash command"
                checked={userInvocable}
                onCheckedChange={setUserInvocable}
                disabled={busy}
              />
            </div>
            <div className="grid gap-1.5">
              <Label
                htmlFor="skill-allowed-tools"
                className="text-xs font-medium"
              >
                Allowed tools{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="skill-allowed-tools"
                value={allowedToolsText}
                onChange={(event) => setAllowedToolsText(event.target.value)}
                placeholder="read_file, bash"
                className="font-mono text-xs"
                disabled={busy}
              />
              <p className="text-[11px] text-muted-foreground">
                Comma-separated. Leave blank to allow all tools.
              </p>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          <DialogFooter className="gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {isSaving
                ? "Saving…"
                : isEditing
                  ? "Save changes"
                  : "Create skill"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
