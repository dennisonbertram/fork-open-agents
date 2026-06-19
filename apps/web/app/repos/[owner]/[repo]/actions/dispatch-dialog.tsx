"use client";

import { Loader2, Play } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ActionsManagerReadinessVerdict } from "@/lib/github/actions-manager/readiness";
import type {
  WorkflowDispatchInput,
  WorkflowItem,
} from "@/lib/github/actions-manager/workflows";

type DispatchDialogProps = {
  baseUrl: string;
  workflows: WorkflowItem[];
  defaultBranch: string;
  writeReadiness: ActionsManagerReadinessVerdict;
  onDispatched: () => Promise<void> | void;
};

const dispatchSchema = z.object({
  workflowId: z.string().min(1),
  ref: z.string().trim().min(1),
  inputs: z.record(z.string(), z.string()).optional(),
});

function mutationErrorCopy(errorKind: string | undefined): string {
  if (errorKind === "github_rate_limited") {
    return "GitHub is rate-limiting requests - try again shortly.";
  }
  if (errorKind === "workflow_not_on_default_branch") {
    return "This workflow must exist on the default branch to be dispatched.";
  }
  if (errorKind === "dispatch_input_invalid") {
    return "Check the workflow inputs and try again.";
  }
  if (errorKind === "app_no_actions_permission") {
    return "Action needed - re-authorize the GitHub App to manage Actions.";
  }
  return "GitHub could not start that workflow.";
}

function defaultValueForInput(input: WorkflowDispatchInput): string {
  if (input.default !== undefined) {
    return input.default;
  }
  return input.type === "boolean" ? "false" : "";
}

async function postDispatch(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as {
    errorKind?: string;
    run?: { id: number };
  };
  if (!response.ok) {
    throw Object.assign(new Error("Request failed"), {
      body: payload,
      status: response.status,
    });
  }
  return payload;
}

export function DispatchDialog({
  baseUrl,
  workflows,
  defaultBranch,
  writeReadiness,
  onDispatched,
}: DispatchDialogProps) {
  const dispatchWorkflows = React.useMemo(
    () => workflows.filter((workflow) => workflow.dispatch),
    [workflows],
  );
  const [open, setOpen] = React.useState(false);
  const [workflowId, setWorkflowId] = React.useState(
    dispatchWorkflows[0]?.id.toString() ?? "",
  );
  const [ref, setRef] = React.useState(defaultBranch);
  const [inputs, setInputs] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const canWrite = writeReadiness.status === "ready";
  const selectedWorkflow =
    dispatchWorkflows.find(
      (workflow) => workflow.id.toString() === workflowId,
    ) ??
    dispatchWorkflows[0] ??
    null;
  const selectedWorkflowInputs = React.useMemo(
    () => selectedWorkflow?.dispatch?.inputs ?? [],
    [selectedWorkflow],
  );
  const disabledReason = !canWrite
    ? (writeReadiness.subtext ??
      "Action needed - re-authorize the GitHub App to manage Actions.")
    : dispatchWorkflows.length === 0
      ? "No workflows in this repo accept manual runs"
      : undefined;

  React.useEffect(() => {
    const nextWorkflowId = dispatchWorkflows[0]?.id.toString() ?? "";
    setWorkflowId((current) =>
      current &&
      dispatchWorkflows.some((workflow) => workflow.id.toString() === current)
        ? current
        : nextWorkflowId,
    );
  }, [dispatchWorkflows]);

  React.useEffect(() => {
    const nextInputs = Object.fromEntries(
      selectedWorkflowInputs.map((input) => [
        input.name,
        defaultValueForInput(input),
      ]),
    );
    setInputs(nextInputs);
    setFormError(null);
  }, [selectedWorkflow?.id, selectedWorkflowInputs]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedWorkflow) {
      return;
    }
    setFormError(null);

    const parsed = dispatchSchema.safeParse({
      workflowId,
      ref,
      inputs,
    });
    if (!parsed.success) {
      setFormError("Check the workflow inputs and try again.");
      return;
    }
    if (ref !== defaultBranch) {
      setFormError(
        `This workflow must exist on the default branch (${defaultBranch}) to be dispatched`,
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = await postDispatch(
        `${baseUrl}/workflows/${encodeURIComponent(selectedWorkflow.id.toString())}/dispatch`,
        { ref, inputs },
      );
      toast(
        payload.run
          ? "Run started"
          : "Dispatched - run may take a moment to appear",
      );
      await onDispatched();
      setOpen(false);
    } catch (error) {
      const errorKind =
        error && typeof error === "object"
          ? (error as { body?: { errorKind?: string } }).body?.errorKind
          : undefined;
      setFormError(mutationErrorCopy(errorKind));
      toast.error(mutationErrorCopy(errorKind));
    } finally {
      setIsSubmitting(false);
    }
  };

  const trigger = (
    <Button
      disabled={Boolean(disabledReason)}
      size="sm"
      type="button"
      variant="default"
    >
      <Play className="h-4 w-4" />
      Run workflow
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            {disabledReason ? (
              trigger
            ) : (
              <DialogTrigger asChild>{trigger}</DialogTrigger>
            )}
          </span>
        </TooltipTrigger>
        {disabledReason ? (
          <TooltipContent>{disabledReason}</TooltipContent>
        ) : null}
      </Tooltip>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Run workflow</DialogTitle>
            <DialogDescription>
              Start a workflow_dispatch run on the default branch.
            </DialogDescription>
          </DialogHeader>

          {formError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/[0.04] p-3 text-sm text-destructive">
              {formError}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="workflow">Workflow</Label>
            <Select
              value={workflowId}
              onValueChange={(value) => setWorkflowId(value)}
            >
              <SelectTrigger id="workflow" className="w-full">
                <SelectValue placeholder="Choose workflow" />
              </SelectTrigger>
              <SelectContent>
                {dispatchWorkflows.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id.toString()}>
                    {workflow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="workflow-ref">Ref</Label>
            <Input
              aria-describedby="workflow-ref-help"
              id="workflow-ref"
              value={ref}
              onChange={(event) => setRef(event.target.value)}
            />
            <p id="workflow-ref-help" className="text-xs text-muted-foreground">
              Defaults to the default branch. The workflow file must exist on
              this branch.
            </p>
          </div>

          {selectedWorkflowInputs.map((input) => (
            <WorkflowInputField
              input={input}
              key={input.name}
              value={inputs[input.name] ?? ""}
              onChange={(value) =>
                setInputs((current) => ({ ...current, [input.name]: value }))
              }
            />
          ))}

          <DialogFooter>
            <Button
              disabled={isSubmitting}
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {isSubmitting ? "Starting..." : "Run workflow"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowInputField({
  input,
  value,
  onChange,
}: {
  input: WorkflowDispatchInput;
  value: string;
  onChange: (value: string) => void;
}) {
  const fieldId = `workflow-input-${input.name}`;
  const helpId = `${fieldId}-help`;

  if (input.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
        <div className="space-y-1">
          <Label htmlFor={fieldId}>{input.name}</Label>
          {input.description ? (
            <p id={helpId} className="text-xs text-muted-foreground">
              {input.description}
            </p>
          ) : null}
        </div>
        <Switch
          aria-describedby={input.description ? helpId : undefined}
          checked={value === "true"}
          id={fieldId}
          onCheckedChange={(checked) => onChange(String(checked))}
        />
      </div>
    );
  }

  if (input.type === "choice" && input.options.length > 0) {
    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId}>{input.name}</Label>
        <Select value={value || input.options[0]} onValueChange={onChange}>
          <SelectTrigger id={fieldId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {input.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {input.description ? (
          <p id={helpId} className="text-xs text-muted-foreground">
            {input.description}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>
        {input.name}
        {input.required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input
        aria-describedby={input.description ? helpId : undefined}
        id={fieldId}
        required={input.required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {input.description ? (
        <p id={helpId} className="text-xs text-muted-foreground">
          {input.description}
        </p>
      ) : null}
    </div>
  );
}
