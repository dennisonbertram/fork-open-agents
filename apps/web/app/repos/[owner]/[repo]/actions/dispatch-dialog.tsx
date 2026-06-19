"use client";

import { useState } from "react";
import { Play, Loader2 } from "lucide-react";
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
import { toast } from "sonner";

export type DispatchableWorkflow = {
  id: number;
  name: string;
  path: string;
  defaultBranch: string;
};

type DispatchDialogProps = {
  workflows: DispatchableWorkflow[];
  owner: string;
  repo: string;
  defaultBranch: string;
  canWrite: boolean;
  onDispatched: () => void;
};

export function DispatchDialog({
  workflows,
  owner,
  repo,
  defaultBranch,
  canWrite,
  onDispatched,
}: DispatchDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [ref, setRef] = useState(defaultBranch);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dispatchableWorkflows = workflows.filter((w) => w.id > 0);

  async function handleSubmit() {
    if (!selectedWorkflowId) return;
    setIsSubmitting(true);
    try {
      const url = `/api/github/repos/${owner}/${repo}/actions/workflows/${selectedWorkflowId}/dispatch`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? "Failed to dispatch workflow",
        );
      }
      toast.success("Run started");
      setOpen(false);
      onDispatched();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to dispatch");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={!canWrite || dispatchableWorkflows.length === 0}
          title={
            !canWrite
              ? "Action needed — re-authorize the GitHub App to manage Actions"
              : dispatchableWorkflows.length === 0
                ? "No workflows in this repo accept manual runs"
                : undefined
          }
        >
          <Play className="mr-2 h-4 w-4" />
          Run workflow
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run workflow</DialogTitle>
          <DialogDescription>
            Trigger a workflow_dispatch event for the selected workflow on{" "}
            {owner}/{repo}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="workflow">Workflow</Label>
            <Select
              value={selectedWorkflowId}
              onValueChange={setSelectedWorkflowId}
            >
              <SelectTrigger id="workflow">
                <SelectValue placeholder="Select a workflow" />
              </SelectTrigger>
              <SelectContent>
                {dispatchableWorkflows.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ref">Branch</Label>
            <Input
              id="ref"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder={defaultBranch}
            />
            <p className="text-xs text-muted-foreground">
              Defaults to the default branch. The workflow file must exist on
              this branch.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedWorkflowId}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting…
              </>
            ) : (
              "Run workflow"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
