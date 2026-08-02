"use client";

import { Plus, X } from "lucide-react";
import { useMemo } from "react";
import { GitHubRepositoryCombobox } from "@/components/github-repository-combobox";
import { ModelCombobox } from "@/components/model-combobox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useModelOptions } from "@/hooks/use-model-options";
import { cn } from "@/lib/utils";
import { withMissingModelOption } from "@/lib/model-options";
import type {
  GithubActions,
  WriteScope,
} from "@/lib/background-agents/agent-spec";

const MAX_SPECIFIC_REPOS = 50;

export type GithubActionsPanelValue = {
  githubActions: GithubActions;
  writeScope: WriteScope;
  requireCiGreenForMerge: boolean;
  modelId: string | null;
};

export type GithubActionsPanelProps = {
  value: GithubActionsPanelValue;
  onChange: (value: GithubActionsPanelValue) => void;
  disabled?: boolean;
};

type ActionToggleDef = {
  key: keyof GithubActions;
  label: string;
  description: string;
  /** Risk copy shown for actions that are off by default and should be
   * enabled deliberately. */
  riskCopy?: string;
};

const ACTION_TOGGLES: ActionToggleDef[] = [
  {
    key: "open_pull_request",
    label: "Open pull requests",
    description: "Push a branch and open a pull request with its changes.",
  },
  {
    key: "comment_on_pr_or_issue",
    label: "Comment on PRs or issues",
    description: "Leave a written comment on the pull request or issue.",
  },
  {
    key: "approve_pull_request",
    label: "Approve pull requests",
    description: "Formally approve a pull request review.",
    riskCopy: "Off by default; enable deliberately.",
  },
  {
    key: "request_changes",
    label: "Request changes",
    description: "Request changes on a pull request review.",
    riskCopy: "Off by default; enable deliberately.",
  },
  {
    key: "merge_pull_request",
    label: "Merge pull requests",
    description: "Merge a pull request directly.",
    riskCopy: "Off by default; enable deliberately.",
  },
  {
    key: "push",
    label: "Push commits",
    description: "Push commits directly to a branch.",
    riskCopy: "Off by default; enable deliberately.",
  },
  {
    key: "delete_branch",
    label: "Delete branches",
    description: "Delete a branch after it's merged or abandoned.",
    riskCopy: "Off by default; enable deliberately.",
  },
];

function isActionEnabled(actions: GithubActions, key: keyof GithubActions) {
  return actions[key] ?? false;
}

/**
 * Shared GitHub actions panel used by both the repo-scoped agent spec editor
 * and the settings wizard (#747).
 *
 * Renders the seven action toggles, a CI-green sub-toggle nested under
 * "Merge pull requests", a write-scope selector (this repo / all repos /
 * specific repos), and a searchable model selector. Controlled component:
 * all state lives in the parent via value/onChange.
 */
export function GithubActionsPanel({
  value,
  onChange,
  disabled = false,
}: GithubActionsPanelProps) {
  const { githubActions, writeScope, requireCiGreenForMerge, modelId } = value;
  const { modelOptions, loading: modelOptionsLoading } = useModelOptions();
  const modelItems = useMemo(
    () =>
      withMissingModelOption(modelOptions, modelId).map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        isVariant: option.isVariant,
        provider: option.provider,
      })),
    [modelId, modelOptions],
  );

  function setAction(key: keyof GithubActions, enabled: boolean) {
    onChange({
      ...value,
      githubActions: { ...githubActions, [key]: enabled },
    });
  }

  function setWriteScope(nextScope: WriteScope) {
    onChange({ ...value, writeScope: nextScope });
  }

  function setWriteScopeMode(mode: WriteScope["mode"]) {
    if (mode === "specific_repos") {
      setWriteScope({
        mode,
        repos: writeScope.repos ?? [],
      });
    } else {
      setWriteScope({ mode });
    }
  }

  function addSpecificRepo() {
    const repos = writeScope.repos ?? [];
    if (repos.length >= MAX_SPECIFIC_REPOS) return;
    setWriteScope({
      mode: "specific_repos",
      repos: [...repos, { owner: "", name: "" }],
    });
  }

  function removeSpecificRepo(index: number) {
    const repos = (writeScope.repos ?? []).filter((_, i) => i !== index);
    setWriteScope({ mode: "specific_repos", repos });
  }

  const mergeEnabled = isActionEnabled(githubActions, "merge_pull_request");
  const specificRepos = writeScope.repos ?? [];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {ACTION_TOGGLES.map((toggle) => {
          const enabled = isActionEnabled(githubActions, toggle.key);
          return (
            <div key={toggle.key} className="space-y-2">
              <div
                className={cn(
                  "flex items-start justify-between gap-3 rounded-md border p-3",
                  enabled ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <div className="min-w-0">
                  <Label
                    htmlFor={`action-${toggle.key}`}
                    className="text-sm font-medium"
                  >
                    {toggle.label}
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {toggle.description}
                  </p>
                  {toggle.riskCopy && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                      {toggle.riskCopy}
                    </p>
                  )}
                </div>
                <Switch
                  id={`action-${toggle.key}`}
                  checked={enabled}
                  disabled={disabled}
                  onCheckedChange={(checked) => setAction(toggle.key, checked)}
                />
              </div>

              {/* CI-green sub-toggle, rendered directly under Merge pull requests */}
              {toggle.key === "merge_pull_request" && (
                <div
                  className={cn(
                    "ml-4 flex items-start justify-between gap-3 rounded-md border border-dashed p-3",
                    !mergeEnabled && "opacity-50",
                  )}
                >
                  <div className="min-w-0">
                    <Label
                      htmlFor="require-ci-green"
                      className="text-sm font-medium"
                    >
                      Require CI green before merging
                    </Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Blocks merge_pull_request unless the latest checks
                      succeeded.
                    </p>
                  </div>
                  <Switch
                    id="require-ci-green"
                    checked={requireCiGreenForMerge}
                    disabled={disabled || !mergeEnabled}
                    onCheckedChange={(checked) =>
                      onChange({ ...value, requireCiGreenForMerge: checked })
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2 border-t border-border/60 pt-4">
        <Label htmlFor="write-scope-mode">Write scope</Label>
        <p className="text-xs text-muted-foreground">
          Which repositories this agent&apos;s write actions may target.
        </p>
        <Select
          value={writeScope.mode}
          onValueChange={(v) => setWriteScopeMode(v as WriteScope["mode"])}
          disabled={disabled}
        >
          <SelectTrigger id="write-scope-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="this_repo">This repo</SelectItem>
            <SelectItem value="all_repos">All repos</SelectItem>
            <SelectItem value="specific_repos">Specific repos</SelectItem>
          </SelectContent>
        </Select>

        {writeScope.mode === "specific_repos" && (
          <div className="space-y-2 pt-1">
            {specificRepos.map((repo, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: repo rows have no stable id until saved
                key={index}
                className="flex items-center gap-2"
              >
                <GitHubRepositoryCombobox
                  value={repo}
                  allowFreeform
                  disabled={disabled}
                  placeholder={`Select repository ${index + 1}`}
                  onChange={(next) => {
                    const repos = (writeScope.repos ?? []).map(
                      (current, repoIndex) =>
                        repoIndex === index ? next : current,
                    );
                    setWriteScope({ mode: "specific_repos", repos });
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  onClick={() => removeSpecificRepo(index)}
                  aria-label={`Remove repo ${index + 1}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || specificRepos.length >= MAX_SPECIFIC_REPOS}
              onClick={addSpecificRepo}
            >
              <Plus className="h-3.5 w-3.5" />
              Add repo
            </Button>
            <p className="text-xs text-muted-foreground">
              Up to {MAX_SPECIFIC_REPOS} repositories.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border/60 pt-4">
        <Label>Model</Label>
        <ModelCombobox
          value={modelId ?? ""}
          items={modelItems}
          placeholder={
            modelOptionsLoading ? "Loading models..." : "Use default model"
          }
          searchPlaceholder="Search models..."
          emptyText="No matching models found."
          emptyOption="Use default model"
          disabled={disabled}
          onChange={(nextModelId) =>
            onChange({
              ...value,
              modelId: nextModelId || null,
            })
          }
        />
        <p className="text-xs text-muted-foreground">
          Search the configured catalog and your connected inference profiles.
          Leave the default option selected to use the account&apos;s default
          model.
        </p>
      </div>
    </div>
  );
}
