"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TriggerKind } from "@/lib/background-agents/agent-spec";

type EventTriggerConditionsProps = {
  triggerKind: TriggerKind;
  conditionActions: string;
  conditionBranches: string;
  conditionLabels: string;
  conditionEnvironments: string;
  conditionSeverities: string;
  onConditionActionsChange: (value: string) => void;
  onConditionBranchesChange: (value: string) => void;
  onConditionLabelsChange: (value: string) => void;
  onConditionEnvironmentsChange: (value: string) => void;
  onConditionSeveritiesChange: (value: string) => void;
};

/**
 * Event-specific condition fields for GitHub event triggers.
 * Renders the appropriate condition inputs based on the selected trigger kind:
 * - Pull request: actions, branches, labels
 * - Issue: actions, labels
 * - Deployment status: environments, statuses (severities)
 * - Schedule / webhook: nothing (no event conditions apply)
 *
 * All values are comma-separated strings that the agent-spec payload builder
 * splits into arrays via buildAgentPayload / buildConditions.
 */
export function EventTriggerConditions({
  triggerKind,
  conditionActions,
  conditionBranches,
  conditionLabels,
  conditionEnvironments,
  conditionSeverities,
  onConditionActionsChange,
  onConditionBranchesChange,
  onConditionLabelsChange,
  onConditionEnvironmentsChange,
  onConditionSeveritiesChange,
}: EventTriggerConditionsProps) {
  if (triggerKind === "github.pull_request") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Leave a field blank to match all values. Use commas to separate
          multiple values.
        </p>
        <div className="space-y-2">
          <Label htmlFor="cond-actions">Actions</Label>
          <Input
            id="cond-actions"
            value={conditionActions}
            placeholder="opened, reopened, synchronize, ready_for_review"
            onChange={(e) => onConditionActionsChange(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            e.g. <span className="font-mono">opened</span>,{" "}
            <span className="font-mono">synchronize</span>
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cond-branches">Branches</Label>
          <Input
            id="cond-branches"
            value={conditionBranches}
            placeholder="main, release/*"
            onChange={(e) => onConditionBranchesChange(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Target (base) branch of the pull request.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cond-labels">Labels</Label>
          <Input
            id="cond-labels"
            value={conditionLabels}
            placeholder="bug, needs-review"
            onChange={(e) => onConditionLabelsChange(e.target.value)}
          />
        </div>
      </div>
    );
  }

  if (triggerKind === "github.issue") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Leave a field blank to match all values. Use commas to separate
          multiple values.
        </p>
        <div className="space-y-2">
          <Label htmlFor="cond-actions">Actions</Label>
          <Input
            id="cond-actions"
            value={conditionActions}
            placeholder="opened, labeled, reopened"
            onChange={(e) => onConditionActionsChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cond-labels">Labels</Label>
          <Input
            id="cond-labels"
            value={conditionLabels}
            placeholder="bug, enhancement"
            onChange={(e) => onConditionLabelsChange(e.target.value)}
          />
        </div>
      </div>
    );
  }

  if (triggerKind === "github.deployment_status") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Leave a field blank to match all values. Use commas to separate
          multiple values.
        </p>
        <div className="space-y-2">
          <Label htmlFor="cond-environments">Environments</Label>
          <Input
            id="cond-environments"
            value={conditionEnvironments}
            placeholder="production, staging"
            onChange={(e) => onConditionEnvironmentsChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cond-severities">Statuses</Label>
          <Input
            id="cond-severities"
            value={conditionSeverities}
            placeholder="success, failure"
            onChange={(e) => onConditionSeveritiesChange(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Deployment states: <span className="font-mono">success</span>,{" "}
            <span className="font-mono">failure</span>,{" "}
            <span className="font-mono">pending</span>
          </p>
        </div>
      </div>
    );
  }

  // Schedule, webhook.error — no event conditions apply.
  return null;
}
