"use client";

import { Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type RepoAgentsDashboardProps = {
  owner: string;
  repo: string;
};

/**
 * Roster entry point for the repo agents page.
 * The "New agent" button navigates to the full-page /agents/new builder.
 * The "Create with AI" button opens a dialog where users can describe what
 * they want in natural language, then navigates to the new agent page with
 * the prompt as context.
 */
export function RepoAgentsDashboard({ owner, repo }: RepoAgentsDashboardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");

  function handleCreateWithAi() {
    if (!prompt.trim()) return;
    const encoded = encodeURIComponent(prompt.trim());
    setOpen(false);
    router.push(`/repos/${owner}/${repo}/agents/new?ai=true&prompt=${encoded}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button asChild>
        <Link href={`/repos/${owner}/${repo}/agents/new`}>
          <Plus className="h-4 w-4" />
          New agent
        </Link>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <Sparkles className="h-4 w-4" />
            Create with AI
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create with AI</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Describe the background agent you want in plain language. You will
              be taken to the agent builder where you can review and edit the
              result before saving.
            </p>
            <Textarea
              placeholder="e.g. When a new issue is opened, label it by type and add a triage comment."
              value={prompt}
              maxLength={2000}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-24"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleCreateWithAi();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {prompt.length > 0
                  ? `${prompt.length} / 2000`
                  : "Enter a description of what you want this agent to do."}
              </span>
              <Button
                onClick={handleCreateWithAi}
                disabled={!prompt.trim()}
                size="sm"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate spec
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
