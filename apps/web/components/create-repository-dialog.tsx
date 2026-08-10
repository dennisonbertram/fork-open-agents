"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink, FolderGit2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  submitCreateRepository,
  type CreatedRepository,
} from "@/components/create-repository-submit";

// GitHub repo names: alphanumerics, hyphens, underscores, periods; max 100.
const REPO_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

interface CreateRepositoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Account login the repo is created under (fixed by the picker). */
  owner: string;
  /** The installation's repository selection scope, for the success warning. */
  repositorySelection: "all" | "selected";
  /** Link to manage the installation's repo access, when known. */
  installationUrl: string | null;
  onCreated: (result: CreatedRepository) => void;
  /** Pre-seeds the error state. Used only in tests (mirrors NewSessionDialog). */
  _testError?: string | null;
  /** Pre-seeds the success state. Used only in tests. */
  _testResult?: CreatedRepository | null;
}

export function CreateRepositoryDialog({
  open,
  onOpenChange,
  owner,
  repositorySelection,
  installationUrl,
  onCreated,
  _testError,
  _testResult,
}: CreateRepositoryDialogProps) {
  const [repoName, setRepoName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<CreatedRepository | null>(
    _testResult ?? null,
  );
  const [error, setError] = useState<string | null>(_testError ?? null);

  // Reset form state when dialog opens
  useEffect(() => {
    if (open) {
      setRepoName("");
      setDescription("");
      setIsPrivate(true);
      setResult(null);
      setError(null);
    }
  }, [open]);

  const isNameValid = REPO_NAME_PATTERN.test(repoName.trim());

  const handleCreate = async () => {
    if (!repoName.trim()) {
      setError("Repository name is required");
      return;
    }
    if (!isNameValid) {
      setError("Use letters, numbers, hyphens, underscores, and periods only.");
      return;
    }

    setIsCreating(true);
    setError(null);

    const outcome = await submitCreateRepository({
      owner,
      repoName: repoName.trim(),
      description,
      isPrivate,
    });

    setIsCreating(false);

    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }

    setResult(outcome.result);
    onCreated(outcome.result);
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderGit2 className="h-5 w-5" />
            Create repository
          </DialogTitle>
          <DialogDescription>
            Create a new empty GitHub repository under {owner}, then start a
            session on it.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          // Success state
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
              <Check className="h-6 w-6 text-green-500" />
            </div>
            <div className="text-center">
              <p className="font-medium">Repository created successfully!</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.owner}/{result.repoName}
              </p>
              {result.repoUrl && (
                // External link to GitHub - not internal navigation
                // oxlint-disable-next-line nextjs/no-html-link-for-pages
                <a
                  href={result.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm text-blue-500 hover:underline"
                >
                  View on GitHub
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            {repositorySelection === "selected" && installationUrl && (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                <p className="text-sm text-muted-foreground">
                  The GitHub App only has access to selected repositories, so it
                  cannot see this repo yet. Grant access before starting the
                  session.
                </p>
                {/* External link to GitHub - not internal navigation */}
                {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
                <a
                  href={installationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm text-blue-500 hover:underline"
                >
                  Manage access
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          </div>
        ) : (
          // Form
          <>
            <div className="grid gap-4 py-4">
              {/* Owner (fixed by the picker's current account) */}
              <div className="grid gap-2">
                <Label>Owner</Label>
                <p className="text-sm text-muted-foreground">{owner}</p>
              </div>

              {/* Repository Name */}
              <div className="grid gap-2">
                <Label htmlFor="create-repo-name">Repository name</Label>
                <p className="text-xs text-muted-foreground">
                  {owner}/{repoName.trim() || "…"}
                </p>
                <Input
                  id="create-repo-name"
                  placeholder="my-awesome-project"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  disabled={isCreating}
                />
                <p className="text-xs text-muted-foreground">
                  Use letters, numbers, hyphens, underscores, and periods only.
                </p>
              </div>

              {/* Description */}
              <div className="grid gap-2">
                <Label htmlFor="create-repo-description">
                  Description (optional)
                </Label>
                <Textarea
                  id="create-repo-description"
                  placeholder="A short description of your project"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isCreating}
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Private Toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="create-repo-private">
                    Private repository
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Only you can see this repository
                  </p>
                </div>
                <Switch
                  id="create-repo-private"
                  checked={isPrivate}
                  onCheckedChange={setIsPrivate}
                  disabled={isCreating}
                />
              </div>

              {/* Error Alert */}
              {error && (
                <div
                  role="alert"
                  className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={isCreating || !repoName.trim() || !isNameValid}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create repository"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
