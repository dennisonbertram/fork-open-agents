"use client";

/**
 * node-config-panel.tsx — docked right-side panel for editing a selected node.
 *
 * Design decision: docked aside (not a Sheet overlay) so the canvas stays fully
 * visible while editing. The panel slides in/out with a CSS transition when
 * selectedNodeId changes. This avoids React Flow pointer-events conflicts with
 * Radix Sheet's modal overlay and lets users drag nodes while the panel is open.
 *
 * Per-kind contents:
 *   start/end:    label only
 *   agent_step:   label, instructions (auto-growing textarea), checkCommand,
 *                 outputSchema (JSON, collapsed in "Advanced")
 *   github_check: label, check-kind Select → kind-specific fields
 *   condition:    label, path, op Select, value (hidden for exists)
 *
 * All edits flow through store.updateNodeConfig.
 * Field-level errors are sourced from nodeErrorsById(validationErrors)[nodeId].
 */

import { useCallback, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { useStore } from "zustand";
import type { LoopFlowNode } from "./definition-mapping";
import type {
  LoopDefinition,
  LoopValidationError,
} from "@/lib/agent-loops/types";
import { availableOutputRefs } from "@/lib/agent-loops/output-refs";
import {
  conditionValueVisible,
  conditionValueType,
  nodeErrorsById,
} from "./node-config-panel";
import type { CreateLoopBuilderStoreReturn } from "./use-loop-builder";
import { cn } from "@/lib/utils";
import { AgentConfigFields } from "@/components/agent-config-fields";
import { ContextPathCombobox } from "@/components/context-path-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Small reusable field components ──────────────────────────────────────────

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <Label htmlFor={htmlFor} className="text-xs">
      {children}
    </Label>
  );
}

function FieldHelp({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
      {children}
    </p>
  );
}

// ── Common node fields ────────────────────────────────────────────────────────

function CommonFields({
  node,
  onUpdate,
}: {
  node: LoopFlowNode;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopyId() {
    void navigator.clipboard.writeText(node.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Kind badge styles
  const kindBadge: Record<string, string> = {
    start: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    agent_step: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    github_check: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    condition: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    end: "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400",
  };

  return (
    <div className="space-y-3">
      {/* Kind badge */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            kindBadge[node.data.kind] ?? "bg-muted text-muted-foreground",
          )}
        >
          {node.data.kind.replace(/_/g, " ")}
        </span>
      </div>

      {/* Node ID (read-only, copyable) */}
      <div className="space-y-1">
        <FieldLabel>Node ID</FieldLabel>
        <div className="flex items-center gap-1.5">
          <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-[11px] font-mono text-muted-foreground">
            {node.id}
          </code>
          <button
            type="button"
            onClick={handleCopyId}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Copy node ID"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-600" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        </div>
        <FieldHelp>Read-only identifier used in context paths.</FieldHelp>
      </div>

      {/* Label */}
      <div className="space-y-1">
        <FieldLabel htmlFor="node-label">Label</FieldLabel>
        <Input
          id="node-label"
          type="text"
          value={node.data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
        <FieldHelp>Displayed on the canvas card.</FieldHelp>
      </div>
    </div>
  );
}

// ── agent_step config ─────────────────────────────────────────────────────────

function AgentStepConfig({
  node,
  onUpdate,
  errors,
}: {
  node: LoopFlowNode;
  onUpdate: (patch: Record<string, unknown>) => void;
  errors: LoopValidationError[];
}) {
  if (node.data.kind !== "agent_step") return null;

  const data = node.data;

  return (
    <AgentConfigFields
      instructions={{
        id: "instructions",
        value: data.instructions ?? "",
        onChange: (value) => onUpdate({ instructions: value || undefined }),
        placeholder: "Describe what the agent should do...",
        textareaClassName: "min-h-[120px] resize-y font-mono",
        expandedTitle: `Instructions - ${data.label}`,
        expandedDescription: (
          <>
            What the agent should do in the sandbox for this step. Write JSON to{" "}
            <code className="font-mono text-xs">
              /tmp/loop-step-output.json
            </code>{" "}
            to pass output to downstream nodes.
          </>
        ),
        expandedAriaLabel: "Instructions (expanded editor)",
        help: (
          <>
            The agent will follow these instructions in the sandbox. Your agent
            must write JSON to{" "}
            <code className="font-mono text-[10px]">
              /tmp/loop-step-output.json
            </code>{" "}
            to pass output to downstream nodes.
          </>
        ),
      }}
      checkCommand={{
        id: "check-command",
        value: data.checkCommand ?? "",
        onChange: (value) => onUpdate({ checkCommand: value || undefined }),
        placeholder: "e.g. bun test",
        help: (
          <>
            Runs in the sandbox after the agent completes. Non-zero exit fails
            the step and routes to the failure edge.
          </>
        ),
      }}
      tools={{
        label: "Tools",
        selectedSlugs: data.composioToolkitSlugs ?? [],
        onChange: (slugs) =>
          onUpdate({
            composioToolkitSlugs: slugs.length > 0 ? slugs : undefined,
          }),
        help: (
          <>
            Tools this step&apos;s agent can use (GitHub, Gmail, Slack, …) from
            your connected accounts. Add the GitHub toolkit to let it open
            issues / PRs.
          </>
        ),
      }}
      declaredOutputs={{
        outputSchema: data.outputSchema as Record<string, unknown> | undefined,
        onOutputSchemaChange: (outputSchema) => onUpdate({ outputSchema }),
        contextPathPrefix: `context.${node.id}`,
      }}
      errors={errors.map((error) => error.message)}
    />
  );
}

// ── github_check config ────────────────────────────────────────────────────────

const GITHUB_CHECK_KINDS = [
  { value: "list_issues", label: "List issues" },
  { value: "pr_status", label: "PR status" },
  { value: "deployment_status", label: "Deployment status" },
  { value: "ci_status", label: "CI status" },
] as const;

type GithubCheckKind =
  | "list_issues"
  | "pr_status"
  | "deployment_status"
  | "ci_status";

function GithubCheckConfig({
  node,
  onUpdate,
  errors,
  allNodeIds,
}: {
  node: LoopFlowNode;
  onUpdate: (patch: Record<string, unknown>) => void;
  errors: LoopValidationError[];
  allNodeIds: string[];
}) {
  if (node.data.kind !== "github_check") return null;

  const data = node.data;
  const checkKind: GithubCheckKind =
    (data.check?.kind as GithubCheckKind) ?? "list_issues";

  function handleKindChange(kind: GithubCheckKind) {
    // Reset to the minimal valid config for each kind
    switch (kind) {
      case "list_issues":
        onUpdate({ check: { kind: "list_issues", state: "open" } });
        break;
      case "pr_status":
        onUpdate({ check: { kind: "pr_status", prNumberFrom: "" } });
        break;
      case "deployment_status":
        onUpdate({ check: { kind: "deployment_status" } });
        break;
      case "ci_status":
        onUpdate({ check: { kind: "ci_status", refFrom: "" } });
        break;
    }
  }

  const upstreamHint =
    allNodeIds.filter((id) => id !== node.id).join(", ") ||
    "no other nodes yet";

  return (
    <div className="space-y-3">
      {/* Check kind */}
      <div className="space-y-1">
        <FieldLabel htmlFor="check-kind">Check kind</FieldLabel>
        <Select
          value={checkKind}
          onValueChange={(v) => handleKindChange(v as GithubCheckKind)}
        >
          <SelectTrigger id="check-kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GITHUB_CHECK_KINDS.map((k) => (
              <SelectItem key={k.value} value={k.value}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Kind-specific fields */}
      {checkKind === "list_issues" && (
        <>
          <div className="space-y-1">
            <FieldLabel htmlFor="issue-state">State</FieldLabel>
            <Select
              value={
                data.check?.kind === "list_issues"
                  ? (data.check.state ?? "open")
                  : "open"
              }
              onValueChange={(v) =>
                onUpdate({
                  check: {
                    kind: "list_issues",
                    labels:
                      data.check?.kind === "list_issues"
                        ? data.check.labels
                        : undefined,
                    state: v as "open" | "closed",
                  },
                })
              }
            >
              <SelectTrigger id="issue-state" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">open</SelectItem>
                <SelectItem value="closed">closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <FieldLabel htmlFor="issue-labels">
              Labels (comma-separated)
            </FieldLabel>
            <Input
              id="issue-labels"
              type="text"
              value={
                data.check?.kind === "list_issues" && data.check.labels
                  ? data.check.labels.join(", ")
                  : ""
              }
              onChange={(e) => {
                const labels = e.target.value
                  ? e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : undefined;
                onUpdate({
                  check: {
                    kind: "list_issues",
                    state:
                      data.check?.kind === "list_issues"
                        ? data.check.state
                        : "open",
                    ...(labels ? { labels } : {}),
                  },
                });
              }}
              placeholder="bug, enhancement"
            />
            <FieldHelp>Filter by GitHub labels (optional).</FieldHelp>
          </div>
        </>
      )}

      {checkKind === "pr_status" && (
        <div className="space-y-1">
          <FieldLabel htmlFor="pr-number-from">
            PR number from (context path)
          </FieldLabel>
          <Input
            id="pr-number-from"
            type="text"
            className="font-mono"
            value={
              data.check?.kind === "pr_status" ? data.check.prNumberFrom : ""
            }
            onChange={(e) =>
              onUpdate({
                check: { kind: "pr_status", prNumberFrom: e.target.value },
              })
            }
            placeholder="step_id.prNumber"
          />
          <FieldHelp>
            Reference earlier node outputs like{" "}
            <code className="font-mono text-[10px]">step_id.prNumber</code>.
            Available node IDs: {upstreamHint}.
          </FieldHelp>
        </div>
      )}

      {checkKind === "deployment_status" && (
        <div className="space-y-1">
          <FieldLabel htmlFor="environment">Environment (optional)</FieldLabel>
          <Input
            id="environment"
            type="text"
            value={
              data.check?.kind === "deployment_status"
                ? (data.check.environment ?? "")
                : ""
            }
            onChange={(e) =>
              onUpdate({
                check: {
                  kind: "deployment_status",
                  environment: e.target.value || undefined,
                },
              })
            }
            placeholder="production"
          />
          <FieldHelp>
            Filter by deployment environment (e.g. production, staging).
          </FieldHelp>
        </div>
      )}

      {checkKind === "ci_status" && (
        <div className="space-y-1">
          <FieldLabel htmlFor="ref-from">Ref from (context path)</FieldLabel>
          <Input
            id="ref-from"
            type="text"
            className="font-mono"
            value={data.check?.kind === "ci_status" ? data.check.refFrom : ""}
            onChange={(e) =>
              onUpdate({
                check: { kind: "ci_status", refFrom: e.target.value },
              })
            }
            placeholder="step_id.branch"
          />
          <FieldHelp>
            Context path to the git ref (branch/SHA) to check. Available node
            IDs: {upstreamHint}.
          </FieldHelp>
        </div>
      )}

      {/* Field-level errors */}
      {errors.length > 0 && (
        <div className="space-y-1 rounded-md border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-950/20">
          {errors.map((e, i) => (
            <p key={i} className="text-[11px] text-red-600 dark:text-red-400">
              {e.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Condition config ───────────────────────────────────────────────────────────

const CONDITION_OPS = [
  { value: "eq", label: "eq (equals)" },
  { value: "neq", label: "neq (not equals)" },
  { value: "gt", label: "gt (greater than)" },
  { value: "gte", label: "gte (greater than or equal)" },
  { value: "lt", label: "lt (less than)" },
  { value: "lte", label: "lte (less than or equal)" },
  { value: "exists", label: "exists (path present)" },
  { value: "contains", label: "contains (string/array)" },
] as const;

type ConditionOpValue = (typeof CONDITION_OPS)[number]["value"];

function ConditionConfig({
  node,
  onUpdate,
  errors,
  outputRefs = [],
}: {
  node: LoopFlowNode;
  onUpdate: (patch: Record<string, unknown>) => void;
  errors: LoopValidationError[];
  /** `<nodeId>.<field>` refs from upstream step outputs (B-P3 autocomplete). */
  outputRefs?: string[];
}) {
  if (node.data.kind !== "condition") return null;

  const data = node.data;
  const cond = data.condition ?? { path: "", op: "exists" as const };
  const op = cond.op as ConditionOpValue;

  function handleUpdate(field: "path" | "op" | "value", rawValue: unknown) {
    const next = { ...cond };
    if (field === "path") {
      next.path = rawValue as string;
    } else if (field === "op") {
      next.op = rawValue as typeof next.op;
      // Clear value when switching to exists
      if (rawValue === "exists") {
        delete (next as Record<string, unknown>)["value"];
      }
    } else if (field === "value") {
      (next as Record<string, unknown>)["value"] = rawValue;
    }
    onUpdate({ condition: next });
  }

  const valueVisible = conditionValueVisible(op);
  const valueInputType = conditionValueType(op);

  return (
    <div className="space-y-3">
      {/* Path */}
      <div className="space-y-1">
        <FieldLabel htmlFor="cond-path">Context path</FieldLabel>
        <ContextPathCombobox
          id="cond-path"
          value={cond.path}
          suggestions={outputRefs}
          onChange={(nextPath) => handleUpdate("path", nextPath)}
          placeholder="previous_step.output"
        />
        {outputRefs.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {outputRefs.map((ref) => (
              <button
                key={ref}
                type="button"
                onClick={() => handleUpdate("path", ref)}
                className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {ref}
              </button>
            ))}
          </div>
        ) : null}
        <FieldHelp>
          Dot-separated path into an upstream step&apos;s output. Click a
          suggestion above, or type e.g.{" "}
          <code className="font-mono text-[10px]">review.passed</code>.
        </FieldHelp>
      </div>

      {/* Op */}
      <div className="space-y-1">
        <FieldLabel htmlFor="cond-op">Operator</FieldLabel>
        <Select value={op} onValueChange={(v) => handleUpdate("op", v)}>
          <SelectTrigger id="cond-op" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONDITION_OPS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldHelp>
          The condition routes{" "}
          <span className="font-medium text-sky-700 dark:text-sky-300">
            true
          </span>{" "}
          when it passes,{" "}
          <span className="font-medium text-slate-600 dark:text-slate-400">
            false
          </span>{" "}
          when it fails.
        </FieldHelp>
      </div>

      {/* Value (hidden for exists) */}
      {valueVisible && (
        <div className="space-y-1">
          <FieldLabel htmlFor="cond-value">Value</FieldLabel>
          <Input
            id="cond-value"
            type={valueInputType}
            defaultValue={cond.value !== undefined ? String(cond.value) : ""}
            onBlur={(e) => {
              const raw = e.target.value;
              if (valueInputType === "number") {
                const n = Number(raw);
                handleUpdate("value", Number.isNaN(n) ? raw : n);
              } else {
                handleUpdate("value", raw);
              }
            }}
            placeholder={valueInputType === "number" ? "0" : "expected value"}
          />
        </div>
      )}

      {/* Field-level errors */}
      {errors.length > 0 && (
        <div className="space-y-1 rounded-md border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-950/20">
          {errors.map((e, i) => (
            <p key={i} className="text-[11px] text-red-600 dark:text-red-400">
              {e.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── NodeConfigPanel ───────────────────────────────────────────────────────────

export type NodeConfigPanelProps = {
  store: CreateLoopBuilderStoreReturn;
};

export function NodeConfigPanel({ store }: NodeConfigPanelProps) {
  const nodes = useStore(store, (s) => s.nodes);
  const edges = useStore(store, (s) => s.edges);
  const validationErrors = useStore(store, (s) => s.validationErrors);
  const updateNodeConfig = useStore(store, (s) => s.updateNodeConfig);

  // Find selected node
  const selectedNode = nodes.find((n) => n.selected) ?? null;

  // All node ids (for context-path hints in github_check config)
  const allNodeIds = nodes.map((n) => n.id);

  // Available `<nodeId>.<field>` references from upstream step outputs — used to
  // autocomplete condition paths (B-P3, explicit data flow).
  const outputRefs = selectedNode
    ? availableOutputRefs(
        {
          nodes: nodes.map((n) => n.data),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            when: e.data?.when ?? "always",
          })),
        } as LoopDefinition,
        selectedNode.id,
      )
    : [];

  const nodeErrors = nodeErrorsById(validationErrors);
  const currentErrors = selectedNode ? (nodeErrors[selectedNode.id] ?? []) : [];

  const handleUpdate = useCallback(
    (patch: Record<string, unknown>) => {
      if (!selectedNode) return;
      updateNodeConfig(selectedNode.id, patch as Partial<LoopFlowNode["data"]>);
    },
    [selectedNode, updateNodeConfig],
  );

  // Suppress unused warning — edges used for context-path hints
  void edges;

  // Panel is visible when a node is selected
  const isOpen = Boolean(selectedNode);

  return (
    <div
      className={cn(
        "flex h-full shrink-0 flex-col border-l border-border bg-background transition-all duration-200",
        isOpen ? "w-72 opacity-100" : "w-0 overflow-hidden opacity-0",
      )}
      aria-label="Node configuration panel"
    >
      {selectedNode && (
        <>
          {/* Panel header */}
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
            <p className="text-sm font-medium text-foreground">
              Configure node
            </p>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => {
                // Deselect by firing a selection change through store — trigger
                // React Flow's onNodesChange with select: false
                store
                  .getState()
                  .onNodesChange([
                    { id: selectedNode.id, type: "select", selected: false },
                  ]);
              }}
              aria-label="Close panel"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Panel body */}
          <div className="flex-1 overflow-y-auto">
            <div className="space-y-5 p-4">
              {/* Common: kind badge, id, label */}
              <CommonFields node={selectedNode} onUpdate={handleUpdate} />

              {/* Divider */}
              {selectedNode.data.kind !== "start" &&
                selectedNode.data.kind !== "end" && (
                  <hr className="border-border" />
                )}

              {/* Kind-specific config */}
              {selectedNode.data.kind === "agent_step" && (
                <AgentStepConfig
                  node={selectedNode}
                  onUpdate={handleUpdate}
                  errors={currentErrors}
                />
              )}
              {selectedNode.data.kind === "github_check" && (
                <GithubCheckConfig
                  node={selectedNode}
                  onUpdate={handleUpdate}
                  errors={currentErrors}
                  allNodeIds={allNodeIds}
                />
              )}
              {selectedNode.data.kind === "condition" && (
                <ConditionConfig
                  node={selectedNode}
                  onUpdate={handleUpdate}
                  errors={currentErrors}
                  outputRefs={outputRefs}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
